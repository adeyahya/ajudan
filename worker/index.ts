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
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Job, JobKind } from "@/db/schema";
import { CAPABILITY } from "@/lib/capabilities";
import { readConfig } from "@/lib/folders";
import { claimJob, finishJob, requeueJob, requeueStaleJobs } from "@/lib/jobs";
import { pinDataDir } from "@/lib/paths";
import { acquireWorkerLock, folderWorker, releaseWorkerLock } from "@/lib/worker-lock";
import { handlers } from "./handlers";
import { startScheduler, stopScheduler } from "./scheduler";
import { endFolderSession, PausedError } from "./session";
import { startHumanInbox, stopHumanInbox } from "./humans";
import { startWhatsappSync, stopWhatsappSync } from "./whatsapp-sync";

const CONCURRENCY = Number(process.env.AJUDAN_CONCURRENCY ?? 2);
const once = process.argv.includes("--once");

let running = 0;
const inflight = new Set<Promise<void>>();
let folder: string | null = null;
let switching = false;
/** A folder another worker (another Ajudan window, or `pnpm dev`) is working on. */
let blocked: string | null = null;

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
  if (dir && !acquireWorkerLock(dir)) {
    if (blocked !== dir) {
      console.log(`[worker] ${dir} is already being worked on by another Ajudan worker (pid ${folderWorker(dir)?.pid}); waiting`);
    }
    blocked = dir;
    pinDataDir(null);
    folder = null;
    return;
  }
  blocked = null;
  pinDataDir(dir);
  folder = dir;
  if (!dir) {
    console.log("[worker] no business folder open; waiting");
    return;
  }
  requeueStaleJobs();
  // Approvals left waiting by interrupted tasks: those tasks run again and ask afresh.
  // (Capability requests don't belong to a running task: they stay.)
  db.delete(schema.approvals).where(and(eq(schema.approvals.status, "pending"), ne(schema.approvals.toolName, CAPABILITY))).run();
  db.update(schema.teammates)
    .set({ state: "idle", currentActivity: null })
    .where(inArray(schema.teammates.state, ["working", "waiting"]))
    .run();
  if (!once) {
    startScheduler();
    startWhatsappSync();
    startHumanInbox();
  }
  console.log(`[worker] working on ${dir}`);
}

async function switchTo(dir: string | null) {
  switching = true;
  console.log(`[worker] switching folder → ${dir ?? "(none)"}`);
  stopScheduler();
  stopWhatsappSync();
  stopHumanInbox();
  endFolderSession(); // aborts running Claude calls; their jobs go back to the queue
  await Promise.allSettled([...inflight]);
  if (folder) releaseWorkerLock(folder);
  activate(dir);
  switching = false;
}

let lastBlockedTry = 0;

function tick() {
  if (switching) return;
  const wanted = wantedFolder();
  // Another worker has it: try again now and then.
  if (wanted && wanted === blocked) {
    if (Date.now() - lastBlockedTry > 5000) {
      lastBlockedTry = Date.now();
      activate(wanted);
    }
    return;
  }
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
    if (folder) releaseWorkerLock(folder);
    process.exit(0);
  });
}
process.on("exit", () => {
  stopWhatsappSync();
  if (folder) releaseWorkerLock(folder);
});

/** Started by the desktop app: quit if the app is gone (crashed or force-quit). */
function exitWithParent() {
  const parent = Number(process.env.AJUDAN_PARENT_PID);
  if (!parent) return;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      console.log("[worker] the Ajudan app is gone; stopping");
      process.kill(process.pid, "SIGTERM");
    }
  }, 5000).unref();
}

async function main() {
  exitWithParent();
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
