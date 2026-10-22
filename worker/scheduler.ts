/**
 * Turns teammate cron schedules into tasks. Every 60s it syncs one croner job per
 * active teammate that has both `schedule` and `schedulePrompt`.
 */
import { Cron } from "croner";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { validCron } from "@/lib/onboarding/schedule";
import { createTask } from "@/lib/tasks";

const SYNC_MS = 60_000;
const jobs = new Map<string, { pattern: string; prompt: string; cron: Cron }>();

let timer: ReturnType<typeof setInterval> | undefined;

/** Run schedules for the open business folder. */
export function startScheduler() {
  stopScheduler();
  syncSchedules();
  timer = setInterval(syncSchedules, SYNC_MS);
}

/** Stop every schedule (the folder is being closed). */
export function stopScheduler() {
  clearInterval(timer);
  timer = undefined;
  for (const j of jobs.values()) j.cron.stop();
  jobs.clear();
}

/** Add, remove or replace cron jobs to match the database. Exported for tests. */
export function syncSchedules() {
  const rows = db
    .select()
    .from(schema.teammates)
    .where(
      and(
        eq(schema.teammates.status, "active"),
        isNotNull(schema.teammates.schedule),
        isNotNull(schema.teammates.schedulePrompt),
      ),
    )
    .all()
    .filter((t) => t.schedule!.trim() && t.schedulePrompt!.trim());

  const wanted = new Set(rows.map((t) => t.id));
  for (const [id, j] of jobs) {
    if (!wanted.has(id)) {
      j.cron.stop();
      jobs.delete(id);
      console.log(`[scheduler] removed schedule for ${id}`);
    }
  }

  for (const t of rows) {
    const pattern = t.schedule!.trim();
    const prompt = t.schedulePrompt!.trim();
    const existing = jobs.get(t.id);
    if (existing && existing.pattern === pattern && existing.prompt === prompt) continue;
    existing?.cron.stop();
    jobs.delete(t.id);
    // A schedule saved before the hourly minimum existed (or edited by hand) doesn't run.
    if (!validCron(pattern)) {
      console.error(`[scheduler] schedule "${pattern}" for ${t.name} is invalid or runs more than once an hour; skipped`);
      continue;
    }
    try {
      const cron = new Cron(pattern, { protect: true, catch: (e) => console.error("[scheduler]", e) }, () => {
        fire(t.id);
      });
      jobs.set(t.id, { pattern, prompt, cron });
      console.log(`[scheduler] ${t.name}: "${pattern}" next at ${cron.nextRun()?.toISOString()}`);
    } catch (err) {
      console.error(`[scheduler] invalid cron "${pattern}" for ${t.name}:`, (err as Error).message);
    }
  }
  return jobs.size;
}

/** Create the scheduled task, unless the previous scheduled run is still pending. */
export function fire(teammateId: string) {
  const t = db.select().from(schema.teammates).where(eq(schema.teammates.id, teammateId)).get();
  if (!t || t.status !== "active" || !t.schedulePrompt) return undefined;
  const pending = db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.teammateId, t.id),
        eq(schema.tasks.createdBy, "schedule"),
        inArray(schema.tasks.status, ["queued", "running", "waiting_approval"]),
      ),
    )
    .get();
  if (pending) {
    console.log(`[scheduler] ${t.name}: previous scheduled task still pending, skipping`);
    return undefined;
  }
  return createTask({
    businessId: t.businessId,
    teammateId: t.id,
    instructions: t.schedulePrompt,
    createdBy: "schedule",
  });
}
