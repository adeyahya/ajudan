import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval, Task } from "@/db/schema";
import { describeDeliverable } from "@/lib/deliverables";
import { MANAGER_ROLE, roleChecklist } from "@/lib/roles";
import { createTask } from "@/lib/tasks";
import { initTeammateWorkspace } from "@/lib/workspace";

/**
 * The manager: the owner's single point of contact. The owner talks to the manager;
 * the manager answers or delegates (assign_task links the child tasks to the owner's
 * request via parentTaskId) and, when all delegated work is finished, gets a
 * "system:report" task to review it and report back in the same chat.
 */

export const REPORT = "system:report";
/** Work a teammate handed on is finished: back to that teammate (not the manager). */
export const RESULTS = "system:results";
/** Rework a saved deliverable: the owner's "Needs changes" or the manager's review (src/lib/feedback.ts). */
export const REVISION = "system:revision";

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
const finished = (t: Pick<Task, "status">) => (FINISHED as readonly string[]).includes(t.status);

/** Where new results go into a follow-up that's still queued (see followUp). */
const NEXT = "\n\n## What to do now\n";

const getTask = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const childrenOf = (ids: string[]) => (ids.length ? db.select().from(schema.tasks).where(inArray(schema.tasks.parentTaskId, ids)).all() : []);

/**
 * Call when a task finishes. Whoever delegated it hears back once everything they
 * handed on is finished: the manager reports to the owner (REPORT), a teammate who
 * sub-delegated folds the results into its own work (RESULTS). A sub-delegation also
 * counts towards the manager's request above it, so the manager reports on it too.
 */
export function onTaskFinished(taskId: string) {
  const task = getTask(taskId);
  if (!task?.parentTaskId || task.createdBy === REPORT) return;
  const parent = getTask(task.parentTaskId);
  if (!parent) return;
  followUp(parent);
  // Depth is capped at 2 (src/lib/tasks.ts), so the grandparent is the furthest up.
  const grand = parent.parentTaskId ? getTask(parent.parentTaskId) : undefined;
  if (grand) followUp(grand);
}

/**
 * The work a delegator waits for: what it handed on, plus what those teammates handed
 * on in turn (one level, the cap). Its own follow-ups and requests to human teammates
 * (open until closed) don't count.
 */
export function delegatedWork(parentId: string, kind: string, humanIds: Set<string>) {
  const children = childrenOf([parentId]);
  const counts = (t: Task) => t.createdBy !== REPORT && !humanIds.has(t.teammateId);
  const direct = children.filter((c) => c.createdBy !== kind && counts(c));
  const nested = childrenOf(direct.map((c) => c.id)).filter(counts);
  return { work: [...direct, ...nested], followUps: children.filter((c) => c.createdBy === kind) };
}

/** Queue (or extend) the delegator's follow-up when everything it handed on is finished. */
function followUp(parent: Task) {
  const delegator = db.select().from(schema.teammates).where(eq(schema.teammates.id, parent.teammateId)).get();
  if (!delegator || delegator.kind !== "ai" || delegator.status !== "active") return;
  const isManager = delegator.roleKey === MANAGER_ROLE.key;
  const kind = isManager ? REPORT : RESULTS;

  const humanIds = new Set(
    db
      .select({ id: schema.teammates.id })
      .from(schema.teammates)
      .where(and(eq(schema.teammates.businessId, parent.businessId), eq(schema.teammates.kind, "human")))
      .all()
      .map((t) => t.id),
  );
  const { work, followUps } = delegatedWork(parent.id, kind, humanIds);
  if (!work.length || work.some((c) => !finished(c))) return;
  // Report again when more work finished since the last follow-up (e.g. a teammate
  // continued after a human teammate sent footage, or a revision came back).
  const last = followUps.reduce<number>((m, c) => Math.max(m, c.createdAt.getTime()), 0);
  const fresh = work.filter((c) => (c.finishedAt?.getTime() ?? 0) > last);
  if (!fresh.length) return;

  const block = describeResults(fresh);
  // Work that finishes together: one follow-up, not two. One still queued gets the new
  // results added instead of a second task.
  const queued = followUps.find((c) => c.status === "queued");
  if (queued) {
    db.update(schema.tasks).set({ instructions: queued.instructions.replace(NEXT, `\n\n${block}${NEXT}`) }).where(eq(schema.tasks.id, queued.id)).run();
    return;
  }

  if (isManager) {
    // The manager reviews the work once per request: the first report may send pieces
    // back (request_revision); every later one reports as is, so it can't loop.
    const review = !followUps.length;
    createTask({
      businessId: parent.businessId,
      teammateId: delegator.id,
      title: `Report: ${parent.title}`.slice(0, 80),
      createdBy: REPORT,
      parentTaskId: parent.id,
      instructions: `Your team has finished ${last ? "more of " : ""}the work you delegated for the owner's request:\n\n> ${quote(parent.instructions, 1500)}\n\n${block}${NEXT}${review ? REVIEW_STEP : FINAL_REPORT}${REPORT_STEP}`,
    });
    return;
  }

  const manager = getManager(parent.businessId);
  const forManager = !!manager && !!parent.parentTaskId && getTask(parent.parentTaskId)?.teammateId === manager.id;
  createTask({
    businessId: parent.businessId,
    teammateId: delegator.id,
    title: `Results: ${parent.title}`.slice(0, 80),
    createdBy: RESULTS,
    // Stays in the request it belongs to, so the manager waits for it and reports it.
    parentTaskId: parent.id,
    // Carries on in the conversation that handed the work on.
    sessionId: parent.sessionId,
    instructions: `Work you handed on is finished. Your task was:\n\n> ${quote(parent.instructions, 1500)}\n\n${block}${NEXT}Check their work against your brief and your checklist (read_deliverable(id) shows a piece in full, with its images). Fold it into your own work: if a piece of yours should include it, change that piece with update_deliverable instead of saving a duplicate. You can't hand it on again: fix small things yourself and say what's still missing. Finish with a short summary of the combined result${forManager ? `; ${manager!.name} (the manager) passes it on to the owner` : " for the owner"}.`,
  });
}

const REVIEW_STEP = `1. Review before you report (once per request). Check each piece of saved work above against what the owner asked, the business goals and KPIs and the owner's preferences in the Context pages, and the maker's checklist. Use read_deliverable(id) to read a piece in full and look at its images. If a piece clearly misses (wrong facts or prices, ignores the request, off-brand, unfinished or placeholder text), send it back with request_revision(deliverable_id, exactly what to fix). That's the only revision round, so be specific, and only for real problems, not taste. If you sent something back, tell the owner in one or two lines what's done and what's being polished; you'll report again when the fixes are in. Otherwise:
2. `;

const FINAL_REPORT = `The team already had its revision round for this request: don't send anything back again. Note anything still imperfect for the owner.
`;

const REPORT_STEP = `Report back to the owner: a short summary of what was done (by whom), where to see it (images and videos show under this message and on the Work page), and anything that needs the owner's decision or approval. If a teammate asked for footage or photos, pass on their shot list and ask the owner to drop the files into this chat. Don't repeat everything; highlight what matters. Don't delegate again unless something clearly failed and is worth one retry.`;

const quote = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text).replace(/\n/g, "\n> ");

/**
 * The finished tasks' results and the work they saved (or revised), with each maker's
 * KPIs and checklist so the delegator can review the actual pieces, not just a summary.
 */
function describeResults(tasks: Task[]) {
  const mates = new Map(
    db
      .select()
      .from(schema.teammates)
      .where(inArray(schema.teammates.id, [...new Set(tasks.map((c) => c.teammateId))]))
      .all()
      .map((t) => [t.id, t]),
  );
  const revised = tasks.map((c) => c.deliverableId).filter((d): d is string => !!d);
  const saved = db
    .select()
    .from(schema.deliverables)
    .where(
      and(
        revised.length
          ? or(inArray(schema.deliverables.taskId, tasks.map((c) => c.id)), inArray(schema.deliverables.id, revised))
          : inArray(schema.deliverables.taskId, tasks.map((c) => c.id)),
        isNull(schema.deliverables.deletedAt),
      ),
    )
    .all();
  let budget = 12_000; // the whole block stays readable on the fast model
  return tasks
    .map((c) => {
      const m = mates.get(c.teammateId);
      const pieces = saved.filter((d) => d.taskId === c.id || d.id === c.deliverableId);
      const work = pieces.map((d) => {
        const text = describeDeliverable(d, m?.name).slice(0, Math.max(300, Math.min(1500, budget)));
        budget -= text.length;
        return text.length < describeDeliverable(d, m?.name).length ? `${text}\n… (read_deliverable("${d.id}") for the rest)` : text;
      });
      const checks = m ? roleChecklist(m.roleKey) : [];
      return [
        `### ${m?.name ?? "Teammate"}: ${c.title} (${c.status})`,
        (c.result ?? "").slice(0, 2500),
        m?.kpis.length ? `KPIs: ${m.kpis.join("; ")}` : "",
        checks.length ? `Checklist: ${checks.join("; ")}` : "",
        work.length ? `Saved work:\n\n${work.join("\n\n---\n\n")}` : "No saved work.",
      ]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");
}

/**
 * Whether a REPORT may still send work back: only the request's first report does
 * (FINAL_REPORT says so in later ones). Checked again by request_revision.
 */
export function canReview(report: Pick<Task, "id" | "createdBy" | "parentTaskId" | "createdAt">) {
  if (report.createdBy !== REPORT || !report.parentTaskId) return false;
  return !db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.parentTaskId, report.parentTaskId), eq(schema.tasks.createdBy, REPORT), lt(schema.tasks.createdAt, report.createdAt)))
    .get();
}

export const DECISION = "system:decision";

/**
 * The owner just approved or rejected something a teammate asked for. Have the
 * manager react right away in the owner's chat (its own lane in the worker): confirm
 * what happens next and, only if something urgent follows, get the team on it.
 * Several decisions in a row become one reply.
 */
export function reactToDecision(
  approval: Pick<Approval, "teammateId" | "taskId" | "summary" | "status" | "note" | "businessId">,
  via: "app" | "whatsapp" = "app",
) {
  const manager = getManager(approval.businessId);
  if (!manager || approval.teammateId === manager.id) return; // the manager's own run carries on by itself
  const ownerId = db.select({ o: schema.businesses.ownerHumanId }).from(schema.businesses).where(eq(schema.businesses.id, approval.businessId)).get()?.o;
  const owner = ownerId ? db.select({ name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.id, ownerId)).get() : undefined;
  const task = approval.taskId ? db.select().from(schema.tasks).where(eq(schema.tasks.id, approval.taskId)).get() : undefined;
  const mate = db.select({ name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.id, approval.teammateId)).get();
  const line = `- ${approval.status === "approved" ? "APPROVED" : "REJECTED"}${via === "whatsapp" ? " (on WhatsApp)" : ""}: ${approval.summary}${approval.note ? ` (owner's note: "${approval.note}")` : ""}${task ? ` [${mate?.name ?? "teammate"}'s task: "${task.title}"]` : ""}`;
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
    instructions: `The owner just decided${via === "whatsapp" ? " on WhatsApp" : " on the Approvals page"}:\n${line}\n\n${
      via === "whatsapp" && owner ? `They're away from the app: send your reply to them on WhatsApp with message_human("${owner.name}") (that's what they'll read), and keep it to a line or two.\n\n` : ""
    }What to do: reply to the owner now in 1–3 short lines: what happens next and when they'll see the result. If approved, the teammate is already carrying on: don't redo or duplicate their work. If rejected, say how it'll be adjusted (the teammate gets the note). Only use assign_task if something new and time-sensitive follows from this decision (for example, after a post goes live, someone should watch and answer the replies); otherwise don't delegate. Check team_status if you're unsure what's happening.`,
  });
}
