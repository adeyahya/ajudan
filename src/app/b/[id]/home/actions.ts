"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { keepReviewItem, markReviewSeen } from "@/lib/home";
import type { ObjectRef } from "@/lib/links";
import { softDelete, TRASH_TYPES, type TrashType } from "@/lib/trash";

/** Home's review queue ("New from the team"): keep an item, move it to Trash, or clear the queue. */

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

const isTrashRef = (r: ObjectRef | undefined): r is { type: TrashType; id: string } =>
  !!r && (TRASH_TYPES as string[]).includes(r.type) && typeof r.id === "string" && !!r.id;

export async function keepNewItem(businessId: string, ref: ObjectRef) {
  ownBusiness(businessId);
  if (!isTrashRef(ref)) return { error: "Not found" };
  keepReviewItem(businessId, ref);
  refresh();
  return { ok: true as const };
}

export async function trashNewItem(businessId: string, ref: ObjectRef) {
  ownBusiness(businessId);
  if (!isTrashRef(ref)) return { error: "Not found" };
  const ok = softDelete(businessId, ref.type, ref.id, "owner");
  refresh();
  return ok ? { ok: true as const } : { error: "Not found" };
}

export async function markAllNewSeen(businessId: string) {
  ownBusiness(businessId);
  markReviewSeen(businessId);
  refresh();
  return { ok: true as const };
}
