"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { DeliverableStatus } from "@/db/schema";
import { moveDocs, renameFolder, saveDocument, setDocsStatus, trashDocs, type DocInput } from "@/lib/docs";

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

const MAX_BULK = 500;
const ids = (list: string[]) => [...new Set(list.filter((x) => typeof x === "string"))].slice(0, MAX_BULK);

export type { DocInput };

/**
 * Write or edit a doc: the owner's own notes and briefs, or the team's saved work. Docs
 * are deliverables, so teammates find them with list_deliverables, and each one is
 * mirrored to work/*.md. Records history and keeps @mention links (src/lib/docs.ts).
 */
export async function saveDoc(businessId: string, doc: DocInput): Promise<{ id: string } | { error: string }> {
  ownBusiness(businessId);
  const r = saveDocument(businessId, doc, "owner");
  if ("id" in r) refresh();
  return r;
}

/** Move a doc to Trash (src/lib/trash.ts takes its work/*.md mirror away too). */
export async function deleteDoc(businessId: string, docId: string) {
  ownBusiness(businessId);
  trashDocs(businessId, [docId], "owner");
  refresh();
}

/** Bulk: move docs into a folder (null or "" for the top level). A new folder appears as soon as a doc is in it. */
export async function moveDocsToFolder(businessId: string, docIds: string[], folder: string | null) {
  ownBusiness(businessId);
  const n = moveDocs(businessId, ids(docIds), folder, "owner");
  refresh();
  return { moved: n };
}

export async function setStatusOfDocs(businessId: string, docIds: string[], status: DeliverableStatus) {
  ownBusiness(businessId);
  const n = setDocsStatus(businessId, ids(docIds), status, "owner");
  refresh();
  return { changed: n };
}

export async function trashManyDocs(businessId: string, docIds: string[]) {
  ownBusiness(businessId);
  const n = trashDocs(businessId, ids(docIds), "owner");
  refresh();
  return { trashed: n };
}

/** Rename (or move) a folder; every doc under it follows. */
export async function renameDocFolder(businessId: string, from: string, to: string) {
  ownBusiness(businessId);
  const r = renameFolder(businessId, from, to, "owner");
  if ("moved" in r) refresh();
  return r;
}
