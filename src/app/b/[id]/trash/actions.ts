"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { emptyTrash, purge, restoreFromTrash, TRASH_TYPES, type TrashType } from "@/lib/trash";

/** Trash page: restore, delete forever, empty (src/lib/trash.ts). */

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

const isType = (v: unknown): v is TrashType => (TRASH_TYPES as string[]).includes(v as string);

export async function restoreItem(businessId: string, type: TrashType, id: string) {
  ownBusiness(businessId);
  if (!isType(type)) return { error: "Not found" };
  const ok = restoreFromTrash(businessId, type, String(id), "owner");
  refresh();
  return ok ? { ok: true as const } : { error: "Not found" };
}

export async function purgeItem(businessId: string, type: TrashType, id: string) {
  ownBusiness(businessId);
  if (!isType(type)) return { error: "Not found" };
  const ok = purge(businessId, type, String(id));
  refresh();
  return ok ? { ok: true as const } : { error: "Not found" };
}

export async function emptyTrashAction(businessId: string) {
  ownBusiness(businessId);
  const n = emptyTrash(businessId);
  refresh();
  return { ok: true as const, count: n };
}
