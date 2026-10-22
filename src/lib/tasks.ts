import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { enqueueJob } from "@/lib/jobs";

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
