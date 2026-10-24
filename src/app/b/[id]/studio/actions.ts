"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { EditKind } from "@/db/schema";
import { AudioSpecSchema, VideoSpecSchema } from "@/lib/edits";
import { enqueueJob } from "@/lib/jobs";

/** The Studio's video and audio editors. Docs, library and contacts actions live in their own routes. */

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
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
