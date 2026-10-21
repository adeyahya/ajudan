/**
 * Ajudan worker: claims jobs from SQLite and runs them through Claude Code.
 * Run with `pnpm worker` (or `pnpm dev`, which starts it alongside Next.js).
 *
 *   pnpm worker            # loop forever
 *   pnpm worker --once     # process queued jobs until the queue is empty, then exit
 */
import { claimJob, finishJob, requeueStaleJobs } from "@/lib/jobs";
import type { Job, JobKind } from "@/db/schema";
import { handlers } from "./handlers";
import { startScheduler } from "./scheduler";

const CONCURRENCY = Number(process.env.AJUDAN_CONCURRENCY ?? 2);
const once = process.argv.includes("--once");

let running = 0;
const inflight = new Set<Promise<void>>();

async function runJob(job: Job) {
  const handler = handlers[job.kind as JobKind];
  console.log(`[worker] job #${job.id} ${job.kind} started`);
  try {
    if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
    await handler(job.payload as never);
    finishJob(job.id);
    console.log(`[worker] job #${job.id} ${job.kind} done`);
  } catch (err) {
    console.error(`[worker] job #${job.id} ${job.kind} failed`, err);
    finishJob(job.id, err);
  }
}

function tick() {
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

async function main() {
  requeueStaleJobs();
  if (once) {
    tick();
    while (inflight.size) {
      await Promise.race(inflight);
      tick();
    }
    return;
  }
  startScheduler();
  console.log(`[worker] started (concurrency ${CONCURRENCY})`);
  setInterval(tick, 500);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
