"use server";

import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { DeliverableStatus, EditKind } from "@/db/schema";
import { deleteContact, importContacts, saveContact, type ContactInput } from "@/lib/contacts";
import { AudioSpecSchema, VideoSpecSchema } from "@/lib/edits";
import { enqueueJob } from "@/lib/jobs";
import { isServablePath } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { removeDeliverableFile, syncDeliverableFile } from "@/lib/workfiles";
import { deleteFromLibrary, organize, type AssetPatch } from "@/lib/assets";
import { logEvent } from "@/lib/events";
import { createTask } from "@/lib/tasks";

const DOC_STATUSES: DeliverableStatus[] = ["draft", "approved", "published", "rejected"];

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

/** Title, note, tags, album or star for one or more library files. */
export async function organizeAssets(businessId: string, paths: string[], patch: AssetPatch, addTags: string[] = []) {
  ownBusiness(businessId);
  const n = organize(businessId, paths, patch, addTags);
  refresh();
  return n;
}

export async function deleteAssets(businessId: string, paths: string[]) {
  ownBusiness(businessId);
  const n = deleteFromLibrary(businessId, paths);
  refresh();
  return n;
}

/**
 * Hand work to a teammate with files from the Studio. While the team rests it waits in
 * the queue and starts when they're back.
 */
export async function planTask(businessId: string, teammateId: string, instructions: string, attachments: string[] = []) {
  ownBusiness(businessId);
  const mate = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .get();
  if (!mate) return { error: "Pick a teammate." };
  if (!instructions.trim()) return { error: "Say what you'd like done." };
  const task = createTask({ businessId, teammateId, instructions, createdBy: "user", attachments: attachments.filter((p) => /^(media|work)\//.test(p)) });
  logEvent({ businessId, teammateId, taskId: task.id, type: "studio_planned", message: `You planned "${task.title}" for ${mate.name} from the Studio` });
  refresh();
  return { ok: `Queued for ${mate.name}: "${task.title}"` };
}

/** Save a video or audio edit (new when no id). Returns its id, or the problem with it. */
export async function saveEdit(
  businessId: string,
  edit: { id?: string; kind: EditKind; title: string; spec: unknown },
): Promise<{ id: string } | { error: string }> {
  ownBusiness(businessId);
  const parsed = (edit.kind === "video" ? VideoSpecSchema : AudioSpecSchema).safeParse(edit.spec);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Something in the edit isn't right" };
  const title = edit.title.trim().slice(0, 120) || (edit.kind === "video" ? "Untitled video" : "Untitled audio");
  const spec = parsed.data as Record<string, unknown>;
  if (edit.id) {
    const row = db
      .update(schema.edits)
      .set({ title, spec, updatedAt: new Date() })
      .where(and(eq(schema.edits.id, edit.id), eq(schema.edits.businessId, businessId)))
      .returning({ id: schema.edits.id })
      .get();
    if (row) return row;
  }
  return db.insert(schema.edits).values({ businessId, kind: edit.kind, title, spec, updatedAt: new Date() }).returning({ id: schema.edits.id }).get();
}

/** Render with ffmpeg in the worker (no Claude: runs even while the team rests). */
export async function renderEditNow(businessId: string, editId: string) {
  ownBusiness(businessId);
  const row = db
    .update(schema.edits)
    .set({ status: "queued", error: null, updatedAt: new Date() })
    .where(and(eq(schema.edits.id, editId), eq(schema.edits.businessId, businessId)))
    .returning()
    .get();
  if (!row) return { error: "Edit not found" };
  enqueueJob("render_edit", { editId });
  return { ok: true as const };
}

export async function deleteEdit(businessId: string, editId: string) {
  ownBusiness(businessId);
  db.delete(schema.edits).where(and(eq(schema.edits.id, editId), eq(schema.edits.businessId, businessId))).run();
  refresh();
}

export type DocInput = {
  id?: string;
  title: string;
  kind: string;
  channel: string;
  content: string;
  status: DeliverableStatus;
  attachments: string[];
};

/**
 * Write or edit a doc: the owner's own notes and briefs, or the team's saved work. Docs
 * are deliverables, so teammates find them with list_deliverables, and each one is
 * mirrored to work/*.md.
 */
export async function saveDoc(businessId: string, doc: DocInput): Promise<{ id: string } | { error: string }> {
  ownBusiness(businessId);
  const title = doc.title.trim().slice(0, 200);
  if (!title) return { error: "Give the doc a title." };
  if (!DOC_STATUSES.includes(doc.status)) return { error: "Unknown status" };
  const values = {
    title,
    kind: doc.kind.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) || "note",
    channel: doc.channel.trim() || null,
    content: doc.content,
    status: doc.status,
    attachments: doc.attachments.filter((p) => isServablePath(p) && fs.existsSync(path.join(dataDir(), p))),
  };
  let id = doc.id;
  if (id) {
    const row = db
      .update(schema.deliverables)
      .set(values)
      .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.businessId, businessId)))
      .returning({ id: schema.deliverables.id })
      .get();
    if (!row) return { error: "Doc not found" };
  } else {
    id = db.insert(schema.deliverables).values({ businessId, ...values }).returning({ id: schema.deliverables.id }).get().id;
    logEvent({ businessId, type: "doc_written", message: `You wrote "${title}" in the Studio`, data: { deliverableId: id } });
  }
  syncDeliverableFile(id);
  refresh();
  return { id };
}

export async function deleteDoc(businessId: string, docId: string) {
  ownBusiness(businessId);
  const gone = db
    .delete(schema.deliverables)
    .where(and(eq(schema.deliverables.id, docId), eq(schema.deliverables.businessId, businessId)))
    .returning({ id: schema.deliverables.id })
    .get();
  if (gone) removeDeliverableFile(gone.id);
  refresh();
}

export async function saveContactAction(businessId: string, input: ContactInput & { id?: string }) {
  ownBusiness(businessId);
  const r = saveContact(businessId, input);
  if ("contact" in r) refresh();
  return "error" in r ? { error: r.error } : { id: r.contact.id };
}

export async function deleteContactAction(businessId: string, id: string) {
  ownBusiness(businessId);
  deleteContact(businessId, id);
  refresh();
}

export async function importContactsAction(businessId: string, text: string) {
  ownBusiness(businessId);
  const r = importContacts(businessId, text);
  refresh();
  return r;
}
