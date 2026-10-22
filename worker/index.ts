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
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Job, JobKind } from "@/db/schema";
import { supersedeStaleApprovals } from "@/lib/approvals";
import { logEvent } from "@/lib/events";
import { folderInfo, readConfig } from "@/lib/folders";
import { claimJob, finishJob, requeueJob, requeueStaleJobs, type Lane } from "@/lib/jobs";
import { pinDataDir } from "@/lib/paths";
import { acquireWorkerLock, folderWorker, releaseWorkerLock } from "@/lib/worker-lock";
import { handlers } from "./handlers";
import { startMaintenance, stopMaintenance } from "./maintenance";
import { startScheduler, stopScheduler } from "./scheduler";
import { CancelledError, endFolderSession, PausedError, runningTasks } from "./session";
import { startHumanInbox, stopHumanInbox } from "./humans";
import { startWhatsappSync, stopWhatsappSync } from "./whatsapp-sync";

/** Teammates' work at once. The owner lane (manager, interview) has its own slots. */
const CONCURRENCY = Number(process.env.AJUDAN_CONCURRENCY ?? 2);
const OWNER_CONCURRENCY = Number(process.env.AJUDAN_OWNER_CONCURRENCY ?? 2);
const once = process.argv.includes("--once");

const running: Record<Lane, number> = { owner: 0, team: 0 };
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
  // Tasks waiting for an approval keep waiting (their session resumes on the decision);
  // approvals asked by a run that restarts from scratch are superseded, it asks afresh.
  const superseded = supersedeStaleApprovals();
  if (superseded) console.log(`[worker] ${superseded} approval request(s) superseded by restarted tasks`);
  // Nothing is running now: "working" and "error" teammates are idle; "waiting" stays
  // only while the teammate really has a task waiting on the owner or a person.
  db.update(schema.teammates)
    .set({ state: "idle", currentActivity: null })
    .where(inArray(schema.teammates.state, ["working", "error"]))
    .run();
  const stillWaiting = db
    .selectDistinct({ id: schema.tasks.teammateId })
    .from(schema.tasks)
    .where(inArray(schema.tasks.status, ["waiting_approval", "waiting_human"]))
    .all()
    .map((t) => t.id);
  db.update(schema.teammates)
    .set({ state: "idle", currentActivity: null })
    .where(and(eq(schema.teammates.state, "waiting"), stillWaiting.length ? notInArray(schema.teammates.id, stillWaiting) : sql`1`))
    .run();
  startMaintenance(dir); // daily backup and pruning; the first run is now
  if (!once) {
    startScheduler();
    startWhatsappSync();
    startHumanInbox();
  }
  console.log(`[worker] working on ${dir}`);
}

function stopFolderServices() {
  stopScheduler();
  stopWhatsappSync();
  stopHumanInbox();
  stopMaintenance();
  endFolderSession(); // aborts running Claude calls; their jobs go back to the queue
}

async function switchTo(dir: string | null) {
  switching = true;
  console.log(`[worker] switching folder → ${dir ?? "(none)"}`);
  try {
    stopFolderServices();
    await Promise.allSettled([...inflight]);
    if (folder) releaseWorkerLock(folder);
    tryActivate(dir);
  } finally {
    switching = false;
  }
}

/** activate(), but a failure (e.g. a broken database) can't wedge the worker. */
function tryActivate(dir: string | null) {
  try {
    activate(dir);
  } catch (err) {
    // Don't work a half-opened folder: treat it as blocked so tick() retries in a while.
    console.error(`[worker] couldn't open ${dir ?? "(none)"}`, err);
    stopFolderServices();
    if (folder) releaseWorkerLock(folder);
    pinDataDir(null);
    folder = null;
    blocked = dir;
    lastBlockedTry = Date.now();
    if (dir) noteActivationFailure(dir, err);
  }
}

/** Best effort: tell the business's activity feed that its worker couldn't start. */
function noteActivationFailure(dir: string, err: unknown) {
  try {
    const { businessId } = folderInfo(dir);
    if (!businessId) return;
    pinDataDir(dir);
    logEvent({ businessId, type: "worker_error", message: `The worker couldn't open this folder: ${(err as Error)?.message ?? err}` });
  } catch {
    // the database itself is probably the problem
  } finally {
    pinDataDir(null);
  }
}

let lastBlockedTry = 0;
let lastCancelCheck = 0;

/** The owner pressed Cancel on a running task (src/lib/tasks.ts): stop its Claude call. */
function abortCancelledRuns() {
  if (!runningTasks.size || Date.now() - lastCancelCheck < 2000) return;
  lastCancelCheck = Date.now();
  const cancelled = db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.id, [...runningTasks.keys()]), eq(schema.tasks.status, "cancelled")))
    .all();
  for (const { id } of cancelled) runningTasks.get(id)?.abort(new CancelledError());
}

function tick() {
  if (switching) return;
  const wanted = wantedFolder();
  // Another worker has it: try again now and then.
  if (wanted && wanted === blocked) {
    if (Date.now() - lastBlockedTry > 5000) {
      lastBlockedTry = Date.now();
      tryActivate(wanted);
    }
    return;
  }
  if (wanted !== folder) {
    void switchTo(wanted);
    return;
  }
  if (!folder) return;
  abortCancelledRuns();
  for (const [lane, max] of [["owner", OWNER_CONCURRENCY], ["team", CONCURRENCY]] as const) {
    while (running[lane] < max) {
      const job = claimJob(lane);
      if (!job) break;
      running[lane]++;
      const p = runJob(job).finally(() => {
        running[lane]--;
        inflight.delete(p);
      });
      inflight.add(p);
    }
  }
}

/** How long a stop waits for running jobs to put themselves back in the queue. */
const SHUTDOWN_MS = Number(process.env.AJUDAN_SHUTDOWN_MS ?? 10_000);
let stopping = false;

/**
 * Stop cleanly: no new claims, abort running Claude calls (their jobs go back to the
 * queue, so a restart doesn't redo their side effects), wait a little for them to
 * settle, free the folder. A second signal exits at once.
 */
async function shutdown(sig: string) {
  if (stopping) {
    console.log(`[worker] ${sig} again; exiting now`);
    process.exit(1);
  }
  stopping = true;
  switching = true; // tick() claims nothing more
  console.log(`[worker] ${sig}: stopping (${inflight.size} job(s) running)`);
  try {
    stopFolderServices();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...inflight]),
      new Promise<void>((r) => {
        timer = setTimeout(r, SHUTDOWN_MS);
      }),
    ]);
    clearTimeout(timer);
    if (inflight.size) console.log(`[worker] ${inflight.size} job(s) didn't settle in ${SHUTDOWN_MS}ms; leaving them for the next start`);
  } catch (err) {
    console.error("[worker] error while stopping", err);
  } finally {
    if (folder) releaseWorkerLock(folder);
    process.exit(0);
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void shutdown(sig));
}
// Don't leave a wacli sync process holding the WhatsApp store lock behind.
process.on("exit", () => {
  stopWhatsappSync();
  if (folder) releaseWorkerLock(folder);
});
// A forgotten promise mustn't take the whole worker down (and with it every job).
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandled rejection", reason);
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
  tryActivate(wantedFolder());
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
