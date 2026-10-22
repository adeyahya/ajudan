import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Task } from "@/db/schema";
import { HUMAN } from "@/lib/humans";
import { DECISION, REPORT, RESULTS, REVISION } from "@/lib/manager";

/**
 * A teammate's recent tasks as a conversation, for continuity between runs: what was
 * asked, what the teammate answered, and what it saved (deliverable ids, so it can
 * refer to or update earlier work). Bounded: the last `limit` tasks, each trimmed.
 * Follow-ups that resume a Claude session don't need it (worker/handlers/task.ts).
 */
export function taskHistory(teammateId: string, beforeTask: Pick<Task, "id" | "createdAt">, limit = 8) {
  const rows = db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.teammateId, teammateId), ne(schema.tasks.id, beforeTask.id)))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(limit)
    .all()
    .filter((t) => t.createdAt <= beforeTask.createdAt)
    .reverse();
  if (!rows.length) return "";
  const saved = new Map<string, string[]>();
  for (const d of db
    .select({ id: schema.deliverables.id, taskId: schema.deliverables.taskId, title: schema.deliverables.title })
    .from(schema.deliverables)
    .where(
      inArray(
        schema.deliverables.taskId,
        rows.map((t) => t.id),
      ),
    )
    .all()) {
    if (d.taskId) saved.set(d.taskId, [...(saved.get(d.taskId) ?? []), `"${d.title}" (id ${d.id})`]);
  }
  return rows
    .map((t) => {
      const files = t.attachments.length ? ` [attached: ${t.attachments.join(", ")}]` : "";
      const ask = t.createdBy === REPORT ? "" : `${askedBy(t.createdBy)}: ${t.instructions.slice(0, 500)}${files}\n`;
      const work = saved.get(t.id)?.length ? `\n(saved: ${saved.get(t.id)!.slice(0, 6).join(", ")})` : "";
      return `${ask}You: ${(t.result ?? `(${t.status})`).slice(0, 700)}${work}`;
    })
    .join("\n\n");
}

function askedBy(createdBy: string) {
  if (createdBy === DECISION) return "Owner's approval decision";
  if (createdBy === RESULTS) return "Results of work you handed on";
  if (createdBy === REVISION) return "Revision requested";
  if (createdBy === "user") return "Owner";
  if (createdBy === "schedule") return "Scheduled";
  if (createdBy === "system:capability") return "Owner (approved your request)";
  if (createdBy === "system:reply") return "WhatsApp reply";
  if (createdBy.startsWith(HUMAN)) return "WhatsApp from a person on the team";
  if (createdBy.startsWith("teammate:")) return "A teammate";
  return "Request";
}
