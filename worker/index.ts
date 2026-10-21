/**
 * Ajudan worker: claims jobs from the open business folder's SQLite queue and runs
 * them through Claude Code. Run with `pnpm worker` (or `pnpm dev`, which starts it
 * alongside Next.js).
 *
 *   pnpm worker            # loop forever, following the open business folder
 *   pnpm worker --once     # process queued jobs until the queue is empty, then exit
 *
 * Only the open folder runs (see src/lib/folders.ts). When you switch folders, the
 * worker aborts what's running, puts those jobs back in the old folder's queue
 * (they run again when it's reopened), stops its schedules and moves on.
 */
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Job, JobKind } from "@/db/schema";
import { readConfig } from "@/lib/folders";
import { claimJob, finishJob, requeueJob, requeueStaleJobs } from "@/lib/jobs";
import { pinDataDir } from "@/lib/paths";
import { handlers } from "./handlers";
import { startScheduler, stopScheduler } from "./scheduler";
import { endFolderSession, PausedError } from "./session";
import { startWhatsappSync, stopWhatsappSync } from "./whatsapp-sync";

const CONCURRENCY = Number(process.env.AJUDAN_CONCURRENCY ?? 2);
const once = process.argv.includes("--once");

let running = 0;
const inflight = new Set<Promise<void>>();
let folder: string | null = null;
let switching = false;

/** Which folder the worker should be working on right now. */
function wantedFolder(): string | null {
  return process.env.AJUDAN_DATA_DIR ?? readConfig().activeFolder;
}

async function runJob(job: Job) {
  const handler = handlers[job.kind as JobKind];
  console.log(`[worker] job #${job.id} ${job.kind} started`);
  try {
    if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
    await handler(job.payload as never);
    finishJob(job.id);
    console.log(`[worker] job #${job.id} ${job.kind} done`);
  } catch (err) {
    if (err instanceof PausedError) {
      requeueJob(job.id);
      console.log(`[worker] job #${job.id} ${job.kind} paused (folder closed)`);
      return;
    }
    console.error(`[worker] job #${job.id} ${job.kind} failed`, err);
    finishJob(job.id, err);
  }
}

/** Open a folder: recover leftovers from a crash or a previous switch, start schedules. */
function activate(dir: string | null) {
  pinDataDir(dir);
  folder = dir;
  if (!dir) {
    console.log("[worker] no business folder open; waiting");
    return;
  }
  requeueStaleJobs();
  db.update(schema.teammates)
    .set({ state: "idle", currentActivity: null })
    .where(inArray(schema.teammates.state, ["working", "waiting"]))
    .run();
  if (!once) {
    startScheduler();
    startWhatsappSync();
  }
  console.log(`[worker] working on ${dir}`);
}

async function switchTo(dir: string | null) {
  switching = true;
  console.log(`[worker] switching folder → ${dir ?? "(none)"}`);
  stopScheduler();
  stopWhatsappSync();
  endFolderSession(); // aborts running Claude calls; their jobs go back to the queue
  await Promise.allSettled([...inflight]);
  activate(dir);
  switching = false;
}

function tick() {
  if (switching) return;
  const wanted = wantedFolder();
  if (wanted !== folder) {
    void switchTo(wanted);
    return;
  }
  if (!folder) return;
  while (running < CONCURRENCY) {
    const job = claimJob();
    if (!job) break;
    running++;
    const p = runJob(job).finally(() => {
      running--;
      inflight.delete(p);
    });
    inflight.add(p);
  }
}

// Don't leave a wacli sync process holding the WhatsApp store lock behind.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopWhatsappSync();
    process.exit(0);
  });
}
process.on("exit", () => stopWhatsappSync());

async function main() {
  activate(wantedFolder());
  if (once) {
    tick();
    while (inflight.size) {
      await Promise.race(inflight);
      tick();
    }
    return;
  }
  console.log(`[worker] started (concurrency ${CONCURRENCY})`);
  setInterval(tick, 500);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
