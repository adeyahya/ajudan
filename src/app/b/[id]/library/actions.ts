"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { deleteFromLibrary, findDuplicates, mergeDuplicates, organize, type AssetPatch } from "@/lib/assets";

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

/** Move library files to Trash (src/lib/trash.ts); restore or purge them from there. */
export async function deleteAssets(businessId: string, paths: string[]) {
  ownBusiness(businessId);
  const n = deleteFromLibrary(businessId, paths);
  refresh();
  return n;
}

/** Library files with identical content, one kept per group. Reads only same-size files. */
export async function findDuplicateAssets(businessId: string) {
  ownBusiness(businessId);
  return findDuplicates(businessId);
}

/** Remove extra copies, keeping one per group (labels and links move to the kept file). */
export async function removeDuplicateAssets(businessId: string, groups: { keep: string; copies: string[] }[]) {
  ownBusiness(businessId);
  let n = 0;
  for (const g of groups) n += await mergeDuplicates(businessId, g.keep, g.copies);
  refresh();
  return n;
}
