import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { ContextPage, ContextSuggestion } from "@/db/schema";
import { listLibrary } from "@/lib/assets";
import { listContacts } from "@/lib/contacts";
import { compactDiff, diffLines, ensureContextWorkspace, listPages, normalizeMarkdown, pageIcon, pendingSuggestions, readerMode, readerRows, SECTIONS } from "@/lib/context";
import { MANAGER_ROLE } from "@/lib/roles";
import type { CoverImage, Mate, SuggestionView, TreePage } from "./types";

/** Server-side reads for the Konteks pages (call inside Suspense: they await connection()). */

export async function contextBase(businessId: string) {
  await connection();
  ensureContextWorkspace(businessId);
  const mates = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active"), eq(schema.teammates.kind, "ai")))
    .all()
    // The manager first, then desks in order.
    .sort((a, b) => Number(b.roleKey === MANAGER_ROLE.key) - Number(a.roleKey === MANAGER_ROLE.key) || a.deskIndex - b.deskIndex);
  return {
    pages: listPages(businessId),
    rows: readerRows(businessId),
    mates,
    mateViews: mates.map((m): Mate => ({ id: m.id, name: m.name, color: m.color, title: m.title })),
    managerId: mates.find((m) => m.roleKey === MANAGER_ROLE.key)?.id ?? null,
  };
}

/** The tree's rows (listPages order: sortOrder, then age), with pending-suggestion counts. */
export async function treePages(businessId: string): Promise<TreePage[]> {
  await connection();
  ensureContextWorkspace(businessId);
  const pending = pendingSuggestions(businessId);
  return listPages(businessId).map((p) => ({
    id: p.id,
    title: p.title,
    section: p.section,
    kind: p.kind,
    key: p.key,
    parentId: p.parentId,
    icon: pageIcon(p),
    pending: pending.filter((s) => s.pageId === p.id).length,
  }));
}

/**
 * The page /context opens on without ?page=: the first top-level page in tree order
 * (the tree highlights the same one; see firstPageId in context-tree.tsx).
 */
export function firstPage(pages: ContextPage[]) {
  const ids = new Set(pages.map((p) => p.id));
  const top = pages.filter((p) => !p.parentId || !ids.has(p.parentId));
  for (const s of SECTIONS) {
    const hit = top.find((p) => p.section === s);
    if (hit) return hit;
  }
  return pages[0];
}

export function readersFor(page: ContextPage, mates: { id: string }[], rows: ReturnType<typeof readerRows>) {
  return mates.map((m) => ({ teammateId: m.id, mode: readerMode(page, m.id, rows) }));
}

export function suggestionView(s: ContextSuggestion, page: ContextPage | undefined, names: Map<string, string>, managerId: string | null): SuggestionView {
  const current = page?.body ?? "";
  const after = s.kind === "new_page" ? s.body : s.kind === "append" ? `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${s.body.trim()}` : s.body;
  return {
    id: s.id,
    kind: s.kind,
    author: s.teammateId ? (names.get(s.teammateId) ?? null) : null,
    authorId: s.teammateId,
    fromChat: !!managerId && s.teammateId === managerId && !!s.taskId,
    reason: s.reason,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
    body: s.body,
    title: s.title,
    section: s.section,
    changedSince: s.kind === "replace" && s.before !== null && page !== undefined && normalizeMarkdown(s.before) !== normalizeMarkdown(page.body),
    diff: compactDiff(diffLines(s.kind === "new_page" ? "" : normalizeMarkdown(current), normalizeMarkdown(after))),
  };
}

export function pendingFor(businessId: string) {
  return pendingSuggestions(businessId);
}

/** Library files with how many saved pieces of work use each (for gallery blocks). */
export function galleryAssets(businessId: string) {
  const uses = new Map<string, number>();
  for (const d of db.select({ a: schema.deliverables.attachments }).from(schema.deliverables).where(eq(schema.deliverables.businessId, businessId)).all()) {
    for (const p of d.a) uses.set(p, (uses.get(p) ?? 0) + 1);
  }
  return listLibrary(businessId)
    .filter((a) => a.tags.length)
    .slice(0, 300)
    .map((a) => ({ path: a.path, title: a.title, tags: a.tags, kind: a.kind, usedIn: uses.get(a.path) ?? 0 }));
}

/** Library images for a page cover (any image, tagged or not). */
export function coverImages(businessId: string): CoverImage[] {
  return listLibrary(businessId)
    .filter((a) => a.kind === "image")
    .slice(0, 120)
    .map((a) => ({ path: a.path, title: a.title }));
}

export function mentionContacts(businessId: string) {
  return listContacts(businessId).map((c) => ({ id: c.id, name: c.name }));
}
