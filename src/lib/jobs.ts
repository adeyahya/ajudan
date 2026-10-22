import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Job, JobKind } from "@/db/schema";
import { MANAGER_ROLE } from "@/lib/roles";

/** Payload shape per job kind. */
export type JobPayloads = {
  onboarding_turn: { businessId: string };
  onboarding_finalize: { businessId: string };
  design_team: { businessId: string };
  run_task: { taskId: string };
  /** A Studio edit rendered with ffmpeg (worker/edits.ts). */
  render_edit: { editId: string };
};

/** Queue work for the worker process (`pnpm worker`). All Claude calls happen there. */
export function enqueueJob<K extends JobKind>(kind: K, payload: JobPayloads[K]) {
  return db.insert(schema.jobs).values({ kind, payload }).returning({ id: schema.jobs.id }).get().id;
}

/**
 * Three lanes, each with its own slots in the worker: "owner" is everything the owner is
 * waiting on in a chat (the manager, the interview, team design); "live" is someone
 * chatting on WhatsApp right now (tasks.urgent); "team" is the teammates' work. Nobody
 * waiting for an answer queues behind long teammate runs.
 */
export type Lane = "owner" | "live" | "team";

export function laneOf(job: Pick<Job, "kind" | "payload">): Lane {
  if (job.kind !== "run_task") return "owner";
  const taskId = String((job.payload as { taskId?: string }).taskId ?? "");
  const row = db
    .select({ role: schema.teammates.roleKey, urgent: schema.tasks.urgent })
    .from(schema.tasks)
    .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
    .where(eq(schema.tasks.id, taskId))
    .get();
  if (row?.urgent) return "live";
  return row?.role === MANAGER_ROLE.key ? "owner" : "team";
}

/** False for jobs that don't call Claude (Studio renders, requests to human teammates): those run while the team rests. */
export function needsClaude(job: Pick<Job, "kind" | "payload">) {
  if (job.kind === "render_edit") return false;
  if (job.kind !== "run_task") return true;
  const taskId = String((job.payload as { taskId?: string }).taskId ?? "");
  const row = db
    .select({ kind: schema.teammates.kind })
    .from(schema.tasks)
    .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
    .where(eq(schema.tasks.id, taskId))
    .get();
  return row?.kind !== "human";
}

/** Atomically claim the oldest queued job (of a lane, if given; only ones `allow` accepts, if given). */
export function claimJob(lane?: Lane, allow?: (job: Job) => boolean) {
  return db.transaction((tx) => {
    const queued = tx.select().from(schema.jobs).where(eq(schema.jobs.status, "queued")).orderBy(asc(schema.jobs.id)).limit(200).all();
    const job = queued.find((j) => (!lane || laneOf(j) === lane) && (!allow || allow(j)));
    if (!job) return undefined;
    tx.update(schema.jobs)
      .set({ status: "running", startedAt: new Date(), attempts: job.attempts + 1 })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return job;
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

/** Put a job back in the queue (its folder was closed mid-run). */
export function requeueJob(id: number) {
  db.update(schema.jobs).set({ status: "queued", startedAt: null }).where(eq(schema.jobs.id, id)).run();
}

/** Jobs left "running" by a worker that crashed go back to the queue on startup. */
export function requeueStaleJobs() {
  db.update(schema.jobs).set({ status: "queued" }).where(eq(schema.jobs.status, "running")).run();
}
