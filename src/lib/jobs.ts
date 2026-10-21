import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { JobKind } from "@/db/schema";

/** Payload shape per job kind. */
export type JobPayloads = {
  onboarding_turn: { businessId: string };
  onboarding_finalize: { businessId: string };
  design_team: { businessId: string };
  run_task: { taskId: string };
};

/** Queue work for the worker process (`pnpm worker`). All Claude calls happen there. */
export function enqueueJob<K extends JobKind>(kind: K, payload: JobPayloads[K]) {
  return db.insert(schema.jobs).values({ kind, payload }).returning({ id: schema.jobs.id }).get().id;
}

/** Atomically claim the oldest queued job of any of the given kinds. */
export function claimJob(kinds?: JobKind[]) {
  return db.transaction((tx) => {
    const filters = [eq(schema.jobs.status, "queued")];
    if (kinds?.length) filters.push(sql`${schema.jobs.kind} in ${kinds}`);
    const job = tx
      .select()
      .from(schema.jobs)
      .where(and(...filters))
      .orderBy(asc(schema.jobs.id))
      .limit(1)
      .get();
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

/** Jobs left "running" by a worker that crashed go back to the queue on startup. */
export function requeueStaleJobs() {
  db.update(schema.jobs).set({ status: "queued" }).where(eq(schema.jobs.status, "running")).run();
}
