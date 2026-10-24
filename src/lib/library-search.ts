import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LibraryItem } from "@/lib/assets";
import { searchWords, textMatches } from "@/lib/library-filter";
import { describeRef, linksTo, type RefInfo } from "@/lib/links";
import { matchIds } from "@/lib/search";

/**
 * Library search and "used in" (src/app/b/[id]/library). Token-free reads of the open
 * folder's database.
 */

/**
 * Library paths matching a search, best first: the full-text index over titles, notes,
 * tags, albums and paths (assets_fts, every word must match), then files whose own name
 * or labels match (files nobody organized have no assets row, so the index can't see
 * them). Trashed files are left out by both. Only paths in `items` are returned.
 */
export function searchLibrary(businessId: string, q: string, items: Pick<LibraryItem, "path" | "name" | "kind" | "title" | "note" | "tags" | "album" | "starred" | "source">[]) {
  const words = searchWords(q);
  if (!words.length) return [];
  const known = new Set(items.map((i) => i.path));
  const ranked = (matchIds("assets", businessId, words, { all: true, limit: 500 }) ?? []).filter((p) => known.has(p));
  const seen = new Set(ranked);
  for (const i of items) {
    if (seen.has(i.path) || !textMatches(i, words)) continue;
    ranked.push(i.path);
    seen.add(i.path);
  }
  return ranked;
}

export type LibraryUsage = {
  deliverables: RefInfo[];
  tasks: (RefInfo & { status: string })[];
  links: RefInfo[];
};

/** JSON attachments arrays that contain exactly this path. */
const hasAttachment = (col: typeof schema.tasks.attachments | typeof schema.deliverables.attachments, rel: string) =>
  sql`exists (select 1 from json_each(${col}) where json_each.value = ${rel})`;

/**
 * Where a library file is used: deliverables (docs, work) and tasks that carry it as an
 * attachment, and objects that link to it (src/lib/links.ts). Trashed items are left out.
 */
export function libraryUsage(businessId: string, rel: string): LibraryUsage {
  const d = schema.deliverables;
  const deliverables = db
    .select({ id: d.id })
    .from(d)
    .where(and(eq(d.businessId, businessId), isNull(d.deletedAt), hasAttachment(d.attachments, rel)))
    .orderBy(sql`${d.createdAt} desc`)
    .limit(50)
    .all()
    .flatMap((r) => describeRef(businessId, { type: "deliverable", id: r.id }) ?? []);
  const t = schema.tasks;
  const tasks = db
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(and(eq(t.businessId, businessId), hasAttachment(t.attachments, rel)))
    .orderBy(sql`${t.createdAt} desc`)
    .limit(50)
    .all()
    .flatMap((r) => {
      const info = describeRef(businessId, { type: "task", id: r.id });
      return info ? [{ ...info, status: r.status }] : [];
    });
  const seen = new Set([...deliverables, ...tasks].map((r) => `${r.type}:${r.id}`));
  const links = linksTo(businessId, { type: "asset", id: rel })
    .flatMap((l) => describeRef(businessId, l) ?? [])
    .filter((r) => !r.deleted && !seen.has(`${r.type}:${r.id}`));
  return { deliverables, tasks, links };
}
