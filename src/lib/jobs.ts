import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Job, JobKind } from "@/db/schema";
import { formatUsd, overBudget, spentToday, startOfDay } from "@/lib/budget";
import { logEvent } from "@/lib/events";
import { MANAGER_ROLE } from "@/lib/roles";

/** A job found "running" after this many claims (worker crashes mid-run) fails for good. */
export const MAX_ATTEMPTS = 3;

/** Payload shape per job kind. */
export type JobPayloads = {
  onboarding_turn: { businessId: string };
  onboarding_finalize: { businessId: string };
  design_team: { businessId: string };
  run_task: { taskId: string };
  /** Rewrite a teammate's grown memory.md into sections (worker/handlers/memory.ts). */
  consolidate_memory: { teammateId: string };
};

/** Queue work for the worker process (`pnpm worker`). All Claude calls happen there. */
export function enqueueJob<K extends JobKind>(kind: K, payload: JobPayloads[K]) {
  return db.insert(schema.jobs).values({ kind, payload }).returning({ id: schema.jobs.id }).get().id;
}

/**
 * Two lanes, each with its own slots in the worker: "owner" is everything the owner is
 * waiting on in a chat (the manager, the interview, team design); "team" is the
 * teammates' work. The manager never queues behind long teammate runs.
 */
export type Lane = "owner" | "team";

export function laneOf(job: Pick<Job, "kind" | "payload">): Lane {
  if (job.kind === "consolidate_memory") return "team";
  if (job.kind !== "run_task") return "owner";
  return taskOf(job)?.role === MANAGER_ROLE.key ? "owner" : "team";
}

/** The task a run_task job runs, with its teammate's role. */
function taskOf(job: Pick<Job, "payload">) {
  const taskId = String((job.payload as { taskId?: string }).taskId ?? "");
  return db
    .select({ businessId: schema.tasks.businessId, role: schema.teammates.roleKey })
    .from(schema.tasks)
    .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
    .where(eq(schema.tasks.id, taskId))
    .get();
}

/**
 * Atomically claim the oldest queued job (of a lane, if given). Task jobs of a
 * business that has spent its daily budget stay queued: they're picked up again
 * tomorrow, or as soon as the owner raises the cap on the Business page.
 */
export function claimJob(lane?: Lane) {
  const paused = new Set<string>();
  const job = db.transaction((tx) => {
    const queued = tx.select().from(schema.jobs).where(eq(schema.jobs.status, "queued")).orderBy(asc(schema.jobs.id)).limit(200).all();
    const budgets = new Map<string, boolean>();
    const withinBudget = (j: Job) => {
      if (j.kind !== "run_task") return true;
      const businessId = taskOf(j)?.businessId;
      if (!businessId) return true;
      if (!budgets.has(businessId)) {
        const biz = tx.select({ cap: schema.businesses.dailyBudgetUsd }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
        const over = !!biz && overBudget(spentToday(businessId), biz.cap);
        budgets.set(businessId, !over);
        if (over) paused.add(businessId);
      }
      return budgets.get(businessId)!;
    };
    const job = queued.find((j) => (!lane || laneOf(j) === lane) && withinBudget(j));
    if (!job) return undefined;
    tx.update(schema.jobs)
      .set({ status: "running", startedAt: new Date(), attempts: job.attempts + 1 })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return job;
  });
  for (const businessId of paused) noteBudgetReached(businessId);
  return job;
}

/** One "budget reached" line in the activity feed per business per day. */
function noteBudgetReached(businessId: string) {
  const today = startOfDay();
  const already = db
    .select({ id: schema.activityEvents.id })
    .from(schema.activityEvents)
    .where(
      and(
        eq(schema.activityEvents.businessId, businessId),
        eq(schema.activityEvents.type, "budget_reached"),
        gte(schema.activityEvents.createdAt, today),
      ),
    )
    .get();
  if (already) return;
  const cap = db.select({ cap: schema.businesses.dailyBudgetUsd }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.cap ?? 0;
  logEvent({
    businessId,
    type: "budget_reached",
    message: `Today's budget of ${formatUsd(cap)} is spent: queued tasks wait until tomorrow, or until you raise the daily budget on the Business page.`,
    data: { dailyBudgetUsd: cap, spentUsd: spentToday(businessId) },
  });
}

export function finishJob(id: number, error?: unknown) {
  db.update(schema.jobs)
    .set({
      status: error ? "failed" : "done",
      error: error ? String(error instanceof Error ? (error.stack ?? error.message) : error) : null,
      finishedAt: new Date(),
    })
    .where(eq(schema.jobs.id, id))
    .run();
}

/** Put a job back in the queue (its folder was closed mid-run). Doesn't count as a try. */
export function requeueJob(id: number) {
  db.update(schema.jobs)
    .set({ status: "queued", startedAt: null, attempts: sql`max(${schema.jobs.attempts} - 1, 0)` })
    .where(eq(schema.jobs.id, id))
    .run();
}

/**
 * Jobs left "running" by a worker that crashed go back to the queue on startup.
 * One that has already been tried MAX_ATTEMPTS times is the likely cause of the
 * crash: it fails instead (and so does its task), so it can't loop forever.
 */
export function requeueStaleJobs() {
  const stale = db.select().from(schema.jobs).where(eq(schema.jobs.status, "running")).all();
  for (const job of stale) {
    if (job.attempts < MAX_ATTEMPTS) {
      db.update(schema.jobs).set({ status: "queued" }).where(eq(schema.jobs.id, job.id)).run();
      continue;
    }
    const reason = `Gave up after ${job.attempts} tries: the worker stopped while running it`;
    finishJob(job.id, reason);
    console.error(`[worker] job #${job.id} ${job.kind} failed: ${reason}`);
    failJobWork(job, reason);
  }
}

/** Mark what a capped job was working on as failed and tell the activity feed. */
function failJobWork(job: Job, reason: string) {
  const payload = job.payload as { taskId?: string; businessId?: string };
  if (job.kind === "run_task") {
    if (!payload.taskId) return;
    const task = db
      .update(schema.tasks)
      .set({ status: "failed", result: reason, finishedAt: new Date() })
      .where(and(eq(schema.tasks.id, payload.taskId), inArray(schema.tasks.status, ["queued", "running", "waiting_approval", "waiting_human"])))
      .returning()
      .get();
    if (!task) return;
    db.update(schema.teammates)
      .set({ state: "error", currentActivity: `Task failed: ${reason}`.slice(0, 140) })
      .where(eq(schema.teammates.id, task.teammateId))
      .run();
    logEvent({
      businessId: task.businessId,
      teammateId: task.teammateId,
      taskId: task.id,
      type: "task_failed",
      message: `"${task.title}" failed: ${reason}`,
      data: { jobId: job.id },
    });
    return;
  }
  if (!payload.businessId) return;
  // Interview and team design: free the chat so the owner can try again.
  db.update(schema.businesses).set({ busy: false }).where(eq(schema.businesses.id, payload.businessId)).run();
  logEvent({ businessId: payload.businessId, type: "job_failed", message: `${job.kind} failed: ${reason}`, data: { jobId: job.id } });
}
