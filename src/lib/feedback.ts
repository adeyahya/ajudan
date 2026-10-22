import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval, Deliverable, Teammate } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { getManager, REVISION } from "@/lib/manager";
import { resolveWorkspace } from "@/lib/paths";
import { createTask } from "@/lib/tasks";
import { syncDeliverableFile } from "@/lib/workfiles";
import { appendLearned } from "@/lib/context";
import { initTeammateWorkspace } from "@/lib/workspace";

/**
 * The owner's feedback loop. "Looks good" and "Needs changes" on the Work page (and a
 * note on a rejected approval) are written where the team will read them again:
 *  - the teammate's own memory.md (read before each of its runs),
 *  - the Context page of what the team learned from the owner, shared by the whole team
 *    (in every teammate's prompt; teammates/TEAM.md is its copy),
 * and "Needs changes" gives the maker a revision task on the same deliverable.
 */

export type Verdict = "good" | "changes";

const day = (d = new Date()) => d.toISOString().slice(0, 10);

/** One line for memory.md: dated, with what it was about, so it survives consolidation. */
export function feedbackEntry(p: { verdict: Verdict; title: string; kind?: string | null; note: string | null; date?: Date }) {
  const what = `"${p.title}"${p.kind ? ` (${p.kind.replace(/_/g, " ")})` : ""}`;
  const said = p.note ? `: "${p.note.replace(/\s+/g, " ").trim()}"` : "";
  return p.verdict === "good"
    ? `- [Owner feedback, ${day(p.date)}] Looks good: ${what}${said || ". Keep doing this."}`
    : `- [Owner feedback, ${day(p.date)}] Needs changes on ${what}${said}`;
}

/** One line for TEAM.md: who made it, so other teammates know whose work it was. */
export function teamNoteEntry(p: { verdict: Verdict; title: string; kind?: string | null; by: string | null; note: string | null; date?: Date }) {
  const what = `"${p.title}"${p.kind ? ` (${p.kind.replace(/_/g, " ")}` : ""}${p.by ? `${p.kind ? ", " : " ("}by ${p.by})` : p.kind ? ")" : ""}`;
  const said = p.note ? `: "${p.note.replace(/\s+/g, " ").trim()}"` : "";
  return p.verdict === "good" ? `- ${day(p.date)} — Looks good: ${what}${said}` : `- ${day(p.date)} — Needs changes on ${what}${said}`;
}

/** A rejected approval with a note: the owner said why, and the whole team should know. */
export function rejectionEntry(p: { summary: string; note: string; date?: Date }) {
  return `- ${day(p.date)} — Rejected: ${p.summary.replace(/\s+/g, " ").trim()}: "${p.note.replace(/\s+/g, " ").trim()}"`;
}

/** Append a line to the team's shared feedback: the "learned" Context page (TEAM.md is its copy). */
export function appendTeamNote(businessId: string, line: string) {
  appendLearned(businessId, line);
}

/** Append a line to a teammate's memory.md (its folder is created if it never ran). */
export function appendTeammateMemory(teammate: Teammate, line: string) {
  let dir = teammate.workspaceDir;
  if (!dir) {
    const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, teammate.businessId)).get();
    if (!biz?.profile) return false;
    dir = initTeammateWorkspace(teammate, biz.profile, biz.language);
    db.update(schema.teammates).set({ workspaceDir: dir }).where(eq(schema.teammates.id, teammate.id)).run();
  }
  fs.mkdirSync(resolveWorkspace(dir), { recursive: true });
  const file = path.join(resolveWorkspace(dir), "memory.md");
  fs.appendFileSync(file, `${fs.existsSync(file) && !fs.readFileSync(file, "utf8").endsWith("\n") ? "\n" : ""}${line}\n`);
  return true;
}

/**
 * The owner's verdict on a deliverable from the Work page. "good" marks a draft
 * approved (work that's ready to post or posted keeps its status); "changes" marks it
 * as needing changes and queues the revision. Both are remembered.
 */
export function recordDeliverableFeedback(p: { businessId: string; deliverableId: string; verdict: Verdict; note?: string | null }) {
  const note = p.note?.trim() || null;
  if (p.verdict === "changes" && !note) throw new Error("Say what should change.");
  const current = db
    .select()
    .from(schema.deliverables)
    .where(and(eq(schema.deliverables.id, p.deliverableId), eq(schema.deliverables.businessId, p.businessId)))
    .get();
  if (!current) throw new Error("Deliverable not found.");
  if (p.verdict === "changes" && current.status === "published") throw new Error("This was already posted. Ask the manager for a new version instead.");
  const status = p.verdict === "changes" ? "rejected" : current.status === "ready_to_post" || current.status === "published" ? current.status : "approved";
  const d = db.update(schema.deliverables).set({ status }).where(eq(schema.deliverables.id, current.id)).returning().get()!;
  syncDeliverableFile(d.id);
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, p.businessId)).get();
  const maker = d.teammateId ? db.select().from(schema.teammates).where(eq(schema.teammates.id, d.teammateId)).get() : undefined;
  if (maker) appendTeammateMemory(maker, feedbackEntry({ verdict: p.verdict, title: d.title, kind: d.kind, note }));
  // Only what was said is a lesson for everyone; a bare "Looks good" is the maker's.
  if (note && business) appendTeamNote(business.id, teamNoteEntry({ verdict: p.verdict, title: d.title, kind: d.kind, by: maker?.name ?? null, note }));
  logEvent({
    businessId: p.businessId,
    teammateId: d.teammateId,
    taskId: d.taskId,
    type: "deliverable_status",
    message: p.verdict === "good" ? `Owner: "${d.title}" looks good${note ? ` ("${note}")` : ""}` : `Owner asked for changes on "${d.title}": "${note}"`,
    data: { deliverableId: d.id, status: d.status, note },
  });
  const task = p.verdict === "changes" ? queueRevision({ d, maker, note: note!, from: "owner" }) : undefined;
  return { deliverable: d, task };
}

/**
 * A revision goes straight to the teammate who made the piece (the manager would only
 * paraphrase the note), in the conversation that made it when its session still exists,
 * and stays in the owner's request (parentTaskId), so the manager reports on the revised
 * work like on any other finished delegation. An archived maker's work goes to the
 * manager. Used for the owner's "Needs changes" and the manager's review
 * (request_revision).
 */
export function queueRevision(p: { d: Deliverable; maker?: Teammate; note: string; from: "owner" | "manager"; parentTaskId?: string | null }) {
  const { d, maker, note } = p;
  // A revision that hasn't started yet takes the new note too, instead of a second run.
  const queued = db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.deliverableId, d.id), eq(schema.tasks.createdBy, REVISION), eq(schema.tasks.status, "queued")))
    .get();
  if (queued) {
    return db
      .update(schema.tasks)
      .set({ instructions: `${queued.instructions}\n\n${p.from === "owner" ? "The owner" : "Your manager"} also said:\n\n> ${note.replace(/\n/g, "\n> ")}` })
      .where(eq(schema.tasks.id, queued.id))
      .returning()
      .get();
  }
  const original = d.taskId ? db.select().from(schema.tasks).where(eq(schema.tasks.id, d.taskId)).get() : undefined;
  const target = maker && maker.status === "active" && maker.kind === "ai" ? maker : getManager(d.businessId);
  if (!target) return undefined;
  const mine = target.id === d.teammateId;
  const who = p.from === "owner" ? "The owner reviewed" : "Your manager reviewed";
  const where = p.from === "owner" ? " on the Work page" : " before reporting to the owner";
  return createTask({
    businessId: d.businessId,
    teammateId: target.id,
    title: `Revise: ${d.title}`.slice(0, 80),
    createdBy: REVISION,
    parentTaskId: p.parentTaskId !== undefined ? p.parentTaskId : requestOf(original?.parentTaskId ?? null),
    sessionId: mine ? (original?.sessionId ?? null) : null,
    attachments: d.attachments,
    deliverableId: d.id,
    instructions: `${who} ${mine ? "your" : `${maker?.name ?? "a former teammate"}'s`} work "${d.title}" (${d.kind.replace(/_/g, " ")}${d.channel ? ` for ${d.channel}` : ""}, deliverable id ${d.id})${where} and asked for changes:

> ${note.replace(/\n/g, "\n> ")}

Read the current version with read_deliverable("${d.id}"), make exactly the changes asked for (and fix anything else the note implies), check it against your checklist, and save the result with update_deliverable("${d.id}", …): that keeps the same deliverable and its earlier version, so don't save a new one. ${d.attachments.length ? "Re-render images or videos only if the note is about them; otherwise keep the attachments. " : ""}Then, if it's ready for the owner to post, mark_ready_to_post again. Finish with a short note of what you changed${p.from === "owner" ? ", and remember the preference in memory.md" : ""}.`,
  });
}

/**
 * The request a revision belongs to: the task the original was delegated from, or,
 * when that was itself a teammate's sub-delegation, the manager's request above it
 * (the owner's revision doesn't need to go back through the teammate who handed it on).
 */
function requestOf(parentTaskId: string | null) {
  if (!parentTaskId) return null;
  const parent = db.select().from(schema.tasks).where(eq(schema.tasks.id, parentTaskId)).get();
  if (!parent) return null;
  const manager = getManager(parent.businessId);
  if (!manager || parent.teammateId === manager.id || !parent.parentTaskId) return parent.id;
  const above = db.select().from(schema.tasks).where(eq(schema.tasks.id, parent.parentTaskId)).get();
  return above?.teammateId === manager.id ? above.id : parent.id;
}

/**
 * The owner rejected a teammate's outward action with a note. The teammate's run gets
 * the note itself (worker/handlers/task.ts); here it's remembered for next time, by
 * that teammate and by the team.
 */
export function recordRejectionNote(approval: Pick<Approval, "businessId" | "teammateId" | "summary" | "note">) {
  const note = approval.note?.trim();
  if (!note) return;
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, approval.businessId)).get();
  const mate = db.select().from(schema.teammates).where(eq(schema.teammates.id, approval.teammateId)).get();
  const line = rejectionEntry({ summary: approval.summary, note });
  if (mate) appendTeammateMemory(mate, line.replace(/^- /, "- [Owner feedback] "));
  if (business) appendTeamNote(business.id, line);
}
