import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval, Task } from "@/db/schema";
import { MANAGER_ROLE } from "@/lib/roles";
import { createTask } from "@/lib/tasks";
import { initTeammateWorkspace } from "@/lib/workspace";

/**
 * The manager: the owner's single point of contact. The owner talks to the manager;
 * the manager answers or delegates (assign_task links the child tasks to the owner's
 * request via parentTaskId) and, when all delegated work is finished, gets a
 * "system:report" task to report back in the same chat.
 */

export const REPORT = "system:report";

export function getManager(businessId: string) {
  return db
    .select()
    .from(schema.teammates)
    .where(
      and(
        eq(schema.teammates.businessId, businessId),
        eq(schema.teammates.roleKey, MANAGER_ROLE.key),
        eq(schema.teammates.status, "active"),
      ),
    )
    .get();
}

/** Every hired team has a manager; create one if missing. */
export function ensureManager(businessId: string) {
  const existing = getManager(businessId);
  if (existing) return existing;
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz || biz.status !== "active") return undefined;
  const m = db
    .insert(schema.teammates)
    .values({
      businessId,
      name: biz.language === "id" ? "Ajeng" : "Avery",
      roleKey: MANAGER_ROLE.key,
      title: biz.language === "id" ? "Manajer Tim" : MANAGER_ROLE.title,
      color: MANAGER_ROLE.color,
      persona: `Manager of ${biz.name}'s AI team. Knows every teammate's role and the business goals, keeps the owner's time free and only asks for decisions that need the owner.`,
      responsibilities: [
        "Be the owner's single point of contact",
        "Hand each request to the right teammate with clear instructions",
        "Report back when the work is done and flag decisions for the owner",
      ],
      kpis: MANAGER_ROLE.defaultKpis,
      autonomy: "ask",
      status: "active",
      deskIndex: -1, // first desk in the office
    })
    .returning()
    .get();
  if (biz.profile) {
    const workspaceDir = initTeammateWorkspace(m, biz.profile, biz.language);
    db.update(schema.teammates).set({ workspaceDir }).where(eq(schema.teammates.id, m.id)).run();
  }
  return m;
}

const FINISHED = ["done", "failed", "cancelled"] as const;

/**
 * Call when a task finishes. If it was delegated by the manager and it was the last
 * open piece of that request, queue the manager's report to the owner.
 */
export function onTaskFinished(taskId: string) {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task?.parentTaskId || task.createdBy === REPORT) return;
  const parent = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.parentTaskId)).get();
  if (!parent) return;
  const manager = getManager(task.businessId);
  if (!manager || parent.teammateId !== manager.id) return;

  // Requests to human teammates stay open until closed; they don't hold up the report.
  const humanIds = new Set(
    db
      .select({ id: schema.teammates.id })
      .from(schema.teammates)
      .where(and(eq(schema.teammates.businessId, task.businessId), eq(schema.teammates.kind, "human")))
      .all()
      .map((t) => t.id),
  );
  const all = db.select().from(schema.tasks).where(eq(schema.tasks.parentTaskId, parent.id)).all();
  const work = all.filter((c) => c.createdBy !== REPORT && !humanIds.has(c.teammateId));
  if (work.some((c) => !(FINISHED as readonly string[]).includes(c.status))) return;
  // Report again when more work finished since the last report (e.g. a teammate
  // continued after a human teammate sent footage).
  const lastReport = all
    .filter((c) => c.createdBy === REPORT)
    .reduce<number>((m, c) => Math.max(m, c.createdAt.getTime()), 0);
  const children = work.filter((c) => (c.finishedAt?.getTime() ?? 0) > lastReport);
  if (!children.length) return;

  const names = new Map(
    db
      .select({ id: schema.teammates.id, name: schema.teammates.name })
      .from(schema.teammates)
      .where(inArray(schema.teammates.id, [...new Set(children.map((c) => c.teammateId))]))
      .all()
      .map((t) => [t.id, t.name]),
  );
  const results = children
    .map(
      (c) =>
        `### ${names.get(c.teammateId) ?? "Teammate"}: ${c.title} (${c.status})\n${(c.result ?? "").slice(0, 2500)}`,
    )
    .join("\n\n");

  createTask({
    businessId: task.businessId,
    teammateId: manager.id,
    title: `Report: ${parent.title}`.slice(0, 80),
    createdBy: REPORT,
    parentTaskId: parent.id,
    instructions: `Your team has finished ${lastReport ? "more of " : ""}the work you delegated for the owner's request:\n\n> ${parent.instructions.slice(0, 1500)}\n\nTheir results:\n\n${results}\n\nReport back to the owner now: a short summary of what was done (by whom), where to see it (images and videos show under this message and on the Work page), and anything that needs the owner's decision or approval. If a teammate asked for footage or photos, pass on their shot list and ask the owner to drop the files into this chat. Don't repeat everything; highlight what matters. Don't delegate again unless something clearly failed and is worth one retry.`,
  });
}

/** Recent manager ↔ owner conversation, for continuity between messages. */
export function managerHistory(managerId: string, beforeTask: Pick<Task, "id" | "createdAt">, limit = 8) {
  const rows = db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.teammateId, managerId), ne(schema.tasks.id, beforeTask.id)))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(limit)
    .all()
    .filter((t) => t.createdAt <= beforeTask.createdAt)
    .reverse();
  if (!rows.length) return "";
  return rows
    .map((t) => {
      const who =
        t.createdBy === REPORT
          ? "Team update (you reported)"
          : t.createdBy === DECISION
            ? "Owner's approval decision"
            : t.createdBy === "user"
              ? "Owner"
              : t.createdBy.startsWith("human:")
                ? "WhatsApp from a person on the team"
                : "Scheduled";
      const files = t.attachments.length ? ` [attached: ${t.attachments.join(", ")}]` : "";
      const ask = t.createdBy === REPORT ? "" : `${who}: ${t.instructions.slice(0, 500)}${files}\n`;
      return `${ask}You: ${(t.result ?? `(${t.status})`).slice(0, 700)}`;
    })
    .join("\n\n");
}

export const DECISION = "system:decision";

/**
 * The owner just approved or rejected something a teammate asked for. Have the
 * manager react right away in the owner's chat (its own lane in the worker): confirm
 * what happens next and, only if something urgent follows, get the team on it.
 * Several decisions in a row become one reply.
 */
export function reactToDecision(approval: Pick<Approval, "teammateId" | "taskId" | "summary" | "status" | "note" | "businessId">) {
  const manager = getManager(approval.businessId);
  if (!manager || approval.teammateId === manager.id) return; // the manager's own run carries on by itself
  const task = approval.taskId ? db.select().from(schema.tasks).where(eq(schema.tasks.id, approval.taskId)).get() : undefined;
  const mate = db.select({ name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.id, approval.teammateId)).get();
  const line = `- ${approval.status === "approved" ? "APPROVED" : "REJECTED"}: ${approval.summary}${approval.note ? ` (owner's note: "${approval.note}")` : ""}${task ? ` [${mate?.name ?? "teammate"}'s task: "${task.title}"]` : ""}`;
  const queued = db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.teammateId, manager.id), eq(schema.tasks.createdBy, DECISION), eq(schema.tasks.status, "queued")))
    .get();
  if (queued) {
    db.update(schema.tasks).set({ instructions: queued.instructions.replace("\n\nWhat to do:", `\n${line}\n\nWhat to do:`) }).where(eq(schema.tasks.id, queued.id)).run();
    return;
  }
  createTask({
    businessId: approval.businessId,
    teammateId: manager.id,
    title: approval.status === "approved" ? `Approved: ${approval.summary}`.slice(0, 80) : `Rejected: ${approval.summary}`.slice(0, 80),
    createdBy: DECISION,
    instructions: `The owner just decided on the Approvals page:\n${line}\n\nWhat to do: reply to the owner now in 1–3 short lines: what happens next and when they'll see the result. If approved, the teammate is already carrying on: don't redo or duplicate their work. If rejected, say how it'll be adjusted (the teammate gets the note). Only use assign_task if something new and time-sensitive follows from this decision (for example, after a post goes live, someone should watch and answer the replies); otherwise don't delegate. Check team_status if you're unsure what's happening.`,
  });
}
