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
  /** `approvalId`: continue a task that waited for this (now decided) approval. */
  run_task: { taskId: string; approvalId?: string };
  /** Rewrite a teammate's grown memory.md into sections (worker/handlers/memory.ts). `force`: the owner asked, whatever its size. */
  consolidate_memory: { teammateId: string; force?: boolean };
  /** A Studio edit rendered with ffmpeg (worker/edits.ts). */
  render_edit: { editId: string };
  /** The inspector's "Test-ask": a dry run on a teammate's context (worker/handlers/context.ts). */
  context_test_ask: { askId: string };
  /** An agent reviews the Context pages and proposes a tidier layout as suggestions (worker/handlers/reorganize.ts). */
  context_reorganize: { businessId: string; auto?: boolean };
};

/** Queue work for the worker process (`pnpm worker`). All Claude calls happen there. */
export function enqueueJob<K extends JobKind>(kind: K, payload: JobPayloads[K]) {
  return db.insert(schema.jobs).values({ kind, payload }).returning({ id: schema.jobs.id }).get().id;
}

/**
 * Four lanes, each with its own slots in the worker: "owner" is everything the owner is
 * waiting on in a chat (the manager, the interview, team design); "live" is someone
 * chatting on WhatsApp right now (tasks.urgent); "team" is the teammates' work; "studio"
 * is Studio renders (one at a time). Nobody waiting for an answer queues behind long runs.
 */
export type Lane = "owner" | "live" | "team" | "studio";

export function laneOf(job: Pick<Job, "kind" | "payload">): Lane {
  // Studio renders (ffmpeg) are long and need no Claude: their own slot, never in the way of chats.
  if (job.kind === "render_edit") return "studio";
  if (job.kind === "consolidate_memory" || job.kind === "context_reorganize") return "team";
  if (job.kind !== "run_task") return "owner";
  const row = taskOf(job);
  if (row?.urgent) return "live";
  return row?.role === MANAGER_ROLE.key ? "owner" : "team";
}

/** The task a run_task job runs, with its teammate's role and kind. */
function taskOf(job: Pick<Job, "payload">) {
  const taskId = String((job.payload as { taskId?: string }).taskId ?? "");
  return db
    .select({ businessId: schema.tasks.businessId, role: schema.teammates.roleKey, urgent: schema.tasks.urgent, kind: schema.teammates.kind })
    .from(schema.tasks)
    .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
    .where(eq(schema.tasks.id, taskId))
    .get();
}

/** False for jobs that don't call Claude (Studio renders, requests to human teammates): those run while the team rests. */
export function needsClaude(job: Pick<Job, "kind" | "payload">) {
  if (job.kind === "render_edit") return false;
  if (job.kind !== "run_task") return true;
  return taskOf(job)?.kind !== "human";
}

/**
 * Atomically claim the oldest queued job (of a lane, if given; only ones `allow` accepts,
 * if given). Task jobs of a business that has spent its daily budget stay queued: they're
 * picked up again tomorrow, or as soon as the owner raises the cap on the Business page.
 */
export function claimJob(lane?: Lane, allow?: (job: Job) => boolean) {
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
    const job = queued.find((j) => (!lane || laneOf(j) === lane) && (!allow || allow(j)) && withinBudget(j));
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
