"use server";

import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { DeliverableStatus } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { isServablePath } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { softDelete } from "@/lib/trash";
import { syncDeliverableFile } from "@/lib/workfiles";

const DOC_STATUSES: DeliverableStatus[] = ["draft", "approved", "published", "rejected"];

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
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
      .set({ ...values, updatedBy: "owner" })
      .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.businessId, businessId), isNull(schema.deliverables.deletedAt)))
      .returning({ id: schema.deliverables.id })
      .get();
    if (!row) return { error: "Doc not found" };
  } else {
    id = db.insert(schema.deliverables).values({ businessId, ...values, createdBy: "owner", updatedBy: "owner" }).returning({ id: schema.deliverables.id }).get().id;
    logEvent({ businessId, type: "doc_written", message: `You wrote "${title}" in Docs`, data: { deliverableId: id } });
  }
  syncDeliverableFile(id);
  refresh();
  return { id };
}

/** Move a doc to Trash (src/lib/trash.ts takes its work/*.md mirror away too). */
export async function deleteDoc(businessId: string, docId: string) {
  ownBusiness(businessId);
  softDelete(businessId, "deliverable", docId, "owner");
  refresh();
}
