import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { enqueueJob } from "@/lib/jobs";
import { onTaskFinished } from "@/lib/manager";

/** Short title from free-form instructions: first line, trimmed to ~60 chars on a word boundary. */
export function deriveTaskTitle(instructions: string) {
  const line = instructions.trim().split(/\r?\n/).find((l) => l.trim()) ?? "Task";
  const clean = line.replace(/\s+/g, " ").replace(/^[-*#>\s]+/, "").trim();
  if (clean.length <= 60) return clean || "Task";
  const cut = clean.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[,.;:]$/, "")}…`;
}

/**
 * How many delegations deep a task may sit (owner → manager = 0, → teammate = 1,
 * → another teammate = 2). Beyond this, assign_task refuses.
 */
export const MAX_DELEGATION_DEPTH = 2;

/** Number of parentTaskId hops from this task up to the original request. */
export function delegationDepth(taskId: string) {
  const seen = new Set<string>();
  let depth = 0;
  let id: string | null = taskId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const row: { parentTaskId: string | null } | undefined = db
      .select({ parentTaskId: schema.tasks.parentTaskId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id))
      .get();
    id = row?.parentTaskId ?? null;
    if (id) depth++;
  }
  return depth;
}

/**
 * Create a task for a teammate and queue it for the worker. Used by the UI,
 * the scheduler and teammate delegation (assign_task).
 * `createdBy` is "user", "schedule", "teammate:<id>" or "system:report" (manager reports).
 */
export function createTask(p: {
  businessId: string;
  teammateId: string;
  title?: string;
  instructions: string;
  createdBy: string;
  /** The task this was delegated from (manager requests). */
  parentTaskId?: string | null;
  /** Folder-relative files to work with ("media/…", "work/…"). */
  attachments?: string[];
  /** A follow-up: resume this Claude session (the task that asked) instead of starting cold. */
  sessionId?: string | null;
}) {
  const instructions = p.instructions.trim();
  if (!instructions) throw new Error("Instructions are required");
  const title = p.title?.trim() || deriveTaskTitle(instructions);
  const task = db
    .insert(schema.tasks)
    .values({
      businessId: p.businessId,
      teammateId: p.teammateId,
      title,
      instructions,
      createdBy: p.createdBy,
      parentTaskId: p.parentTaskId ?? null,
      attachments: p.attachments ?? [],
      sessionId: p.sessionId ?? null,
    })
    .returning()
    .get();
  enqueueJob("run_task", { taskId: task.id });
  logEvent({
    businessId: p.businessId,
    teammateId: p.teammateId,
    taskId: task.id,
    type: "task_queued",
    message: `New task: ${title}`,
    data: { createdBy: p.createdBy },
  });
  return task;
}

/** Statuses the owner can cancel: not started, running, or waiting on them or a person. */
export const CANCELLABLE = ["queued", "running", "waiting_approval", "waiting_human"] as const;

/**
 * Cancel a task. Its open approval requests close too. A running one is stopped by
 * the worker, which notices the status and aborts the Claude call (worker/index.ts);
 * the others are finished here.
 */
export function cancelTask(businessId: string, taskId: string) {
  const task = db
    .update(schema.tasks)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.businessId, businessId), inArray(schema.tasks.status, [...CANCELLABLE])))
    .returning()
    .get();
  if (!task) return undefined;
  db.update(schema.approvals)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(and(eq(schema.approvals.taskId, task.id), eq(schema.approvals.status, "pending")))
    .run();
  // The worker frees a running teammate itself when the abort lands.
  db.update(schema.teammates)
    .set({ state: "idle", currentActivity: null })
    .where(and(eq(schema.teammates.id, task.teammateId), eq(schema.teammates.state, "waiting")))
    .run();
  logEvent({ businessId, teammateId: task.teammateId, taskId: task.id, type: "task_cancelled", message: `"${task.title}" was cancelled` });
  onTaskFinished(task.id);
  return task;
}

/** Run a failed (or cancelled) task again from the start, as the same task. */
export function retryTask(businessId: string, taskId: string) {
  const task = db
    .update(schema.tasks)
    .set({ status: "queued", result: null, startedAt: null, finishedAt: null, sessionId: null })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.businessId, businessId), inArray(schema.tasks.status, ["failed", "cancelled"])))
    .returning()
    .get();
  if (!task) return undefined;
  enqueueJob("run_task", { taskId: task.id });
  logEvent({ businessId, teammateId: task.teammateId, taskId: task.id, type: "task_queued", message: `Retrying: ${task.title}`, data: { retry: true } });
  return task;
}
