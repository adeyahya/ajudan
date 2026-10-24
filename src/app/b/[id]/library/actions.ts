"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { deleteFromLibrary, findDuplicates, listLibrary, mergeDuplicates, organize, type AssetPatch } from "@/lib/assets";
import type { LibraryFilter } from "@/lib/library-filter";
import { libraryUsage, searchLibrary } from "@/lib/library-search";
import { createLibraryView, deleteLibraryView, updateLibraryView } from "@/lib/library-views";

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

/** Title, note, tags, album or star for one or more library files (recorded as the owner's change). */
export async function organizeAssets(businessId: string, paths: string[], patch: AssetPatch, addTags: string[] = []) {
  ownBusiness(businessId);
  const n = organize(businessId, paths, patch, addTags, "owner");
  refresh();
  return n;
}

/** Move library files to Trash (src/lib/trash.ts); restore or purge them from there. */
export async function deleteAssets(businessId: string, paths: string[]) {
  ownBusiness(businessId);
  const n = deleteFromLibrary(businessId, paths, "owner");
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

/** Paths matching the search box, best first (full-text index plus file names). */
export async function searchAssets(businessId: string, q: string) {
  ownBusiness(businessId);
  return searchLibrary(businessId, q, listLibrary(businessId, { team: true }));
}

/** Docs, tasks and links that use one library file. */
export async function assetUsage(businessId: string, path: string) {
  ownBusiness(businessId);
  return libraryUsage(businessId, path);
}

/** What smart-album actions answer: the album's id, or an error the page shows translated. */
export type ViewResult = { id: string } | { error: "name" | "empty" | "tooMany" | "notFound" };

function viewError(err: unknown): ViewResult {
  const m = (err as Error).message;
  if (m.includes("name")) return { error: "name" };
  if (m.includes("filter")) return { error: "empty" };
  if (m.includes("Too many")) return { error: "tooMany" };
  throw err;
}

/** Save the current filters as a smart album. */
export async function createSmartAlbum(businessId: string, name: string, filter: LibraryFilter): Promise<ViewResult> {
  ownBusiness(businessId);
  try {
    const v = createLibraryView(businessId, name, filter);
    refresh();
    return { id: v.id };
  } catch (err) {
    return viewError(err);
  }
}

/** Rename a smart album, or save new filters into it. */
export async function updateSmartAlbum(businessId: string, id: string, patch: { name?: string; filter?: LibraryFilter }): Promise<ViewResult> {
  ownBusiness(businessId);
  try {
    const v = updateLibraryView(businessId, id, patch);
    if (!v) return { error: "notFound" };
    refresh();
    return { id: v.id };
  } catch (err) {
    return viewError(err);
  }
}

/** Delete a smart album (the files stay). */
export async function deleteSmartAlbum(businessId: string, id: string) {
  ownBusiness(businessId);
  const ok = deleteLibraryView(businessId, id);
  refresh();
  return ok;
}
