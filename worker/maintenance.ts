/**
 * Housekeeping for the open business folder: a daily database backup
 * (backups/daily-YYYY-MM-DD.db, the last 7 kept) and pruning of old activity
 * events (and each task's extra tool steps), context loads and finished jobs, which
 * otherwise grow without bound, and the weekly Context review when the owner turned it
 * on (src/lib/reorganize.ts). Runs once when a folder is opened and then once a day.
 */
import fs from "node:fs";
import path from "node:path";
import { and, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { backupsDir } from "@/lib/paths";
import { dueReorganizeBusinesses, reorganizeState, requestReorganize } from "@/lib/reorganize";

const DAY = 24 * 60 * 60 * 1000;
const KEEP_EVENTS_DAYS = 30;
/** Tool steps kept per task: the chat shows a run's latest ones, the rest is noise. */
const KEEP_STEPS_PER_TASK = 200;
/** What runs read (the Context inspector and usage counts look at the last week). */
const KEEP_LOADS_DAYS = 90;
const KEEP_JOBS_DAYS = 14;
const KEEP_DAILY_BACKUPS = 7;

let timer: ReturnType<typeof setInterval> | undefined;

export function startMaintenance(dir: string) {
  stopMaintenance();
  runMaintenance(dir);
  timer = setInterval(() => runMaintenance(dir), DAY);
  timer.unref();
}

export function stopMaintenance() {
  clearInterval(timer);
  timer = undefined;
}

/** Backup first, then prune; neither may stop the worker. */
export function runMaintenance(dir: string) {
  try {
    dailyBackup(dir);
  } catch (err) {
    console.error("[maintenance] backup failed", err);
  }
  try {
    prune();
  } catch (err) {
    console.error("[maintenance] pruning failed", err);
  }
  try {
    for (const id of dueReorganizeBusinesses()) {
      // The owner hasn't looked at the last proposals yet: a new review would replace them.
      if (reorganizeState(id).pending > 0) continue;
      if (requestReorganize(id, true)) console.log(`[maintenance] queued the weekly Context review for ${id}`);
    }
  } catch (err) {
    console.error("[maintenance] couldn't queue the Context review", err);
  }
}

const DAILY = /^daily-\d{4}-\d{2}-\d{2}\.db$/;

/** `VACUUM INTO` a consistent copy (WAL included), once per day, keeping the last few. */
export function dailyBackup(dir: string) {
  const bdir = backupsDir(dir);
  fs.mkdirSync(bdir, { recursive: true });
  const today = path.join(bdir, `daily-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(today)) {
    db.run(sql`VACUUM INTO ${today}`);
    console.log(`[maintenance] backup: ${today}`);
  }
  // Only the daily copies rotate; migration backups (ajudan-*.db) stay.
  const old = fs
    .readdirSync(bdir)
    .filter((f) => DAILY.test(f))
    .sort()
    .slice(0, -KEEP_DAILY_BACKUPS);
  for (const f of old) fs.rmSync(path.join(bdir, f), { force: true });
}

export function prune() {
  const now = Date.now();
  const events = db
    .delete(schema.activityEvents)
    .where(lt(schema.activityEvents.createdAt, new Date(now - KEEP_EVENTS_DAYS * DAY)))
    .run().changes;
  // A long run logs hundreds of steps; keep each task's newest.
  const steps = db.run(sql`
    DELETE FROM activity_events WHERE id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY task_id ORDER BY id DESC) AS n
        FROM activity_events WHERE type = 'tool' AND task_id IS NOT NULL
      ) WHERE n > ${KEEP_STEPS_PER_TASK}
    )`).changes;
  const loads = db.delete(schema.contextLoads).where(lt(schema.contextLoads.createdAt, new Date(now - KEEP_LOADS_DAYS * DAY))).run().changes;
  const jobs = db
    .delete(schema.jobs)
    .where(and(inArray(schema.jobs.status, ["done", "failed"]), lt(schema.jobs.finishedAt, new Date(now - KEEP_JOBS_DAYS * DAY))))
    .run().changes;
  if (events || steps || loads || jobs) console.log(`[maintenance] pruned ${events} old events, ${steps} extra steps, ${loads} old context loads, ${jobs} finished jobs`);
}
