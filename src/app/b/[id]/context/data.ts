import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { ContextPage, ContextSuggestion } from "@/db/schema";
import { listLibrary } from "@/lib/assets";
import { listContacts } from "@/lib/contacts";
import {
  budgetPages,
  compactDiff,
  diffLines,
  ensureContextWorkspace,
  listPages,
  normalizeMarkdown,
  pageForAgents,
  pageIcon,
  pagesFor,
  pendingSuggestions,
  PROMPT_BUDGET,
  readerMode,
  readerRows,
  usageThisWeek,
} from "@/lib/context";
import { isReorganizeSource } from "@/lib/reorganize";
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
    stale: isStale(p),
  }));
}

const DAY = 24 * 3600 * 1000;
/** Days without the owner confirming or changing a page before it asks for a look. */
export const STALE_DAYS = 60;

/** A text page nobody confirmed or changed in STALE_DAYS (databases keep themselves current). */
export function isStale(p: Pick<ContextPage, "kind" | "lastCheckedAt" | "updatedAt" | "createdAt">, now = Date.now()) {
  if (p.kind === "database") return false;
  const seen = Math.max(p.lastCheckedAt?.getTime() ?? 0, p.updatedAt?.getTime() ?? 0, p.createdAt.getTime());
  return now - seen > STALE_DAYS * DAY;
}

/** How full a teammate's prompt is with always-pages (the budget's characters), and which pages were cut. */
export function promptLoad(businessId: string, teammateId: string) {
  const { always } = pagesFor(businessId, teammateId);
  const { items } = budgetPages(always);
  const used = items.reduce((n, i) => n + i.chars, 0);
  return { used, total: PROMPT_BUDGET.total, items };
}

/**
 * The home's "needs you" numbers: suggestions waiting, pages to check, pages nobody read
 * this week (a week old at least), and the room left in the fullest teammate's prompt.
 */
export async function contextHealth(businessId: string, mates: { id: string }[]) {
  await connection();
  const pages = listPages(businessId);
  const usage = usageThisWeek(businessId);
  const now = Date.now();
  const loads = mates.map((m) => promptLoad(businessId, m.id));
  const fullest = loads.reduce((max, l) => Math.max(max, l.used / l.total), 0);
  return {
    pending: pendingSuggestions(businessId).length,
    stale: pages.filter((p) => isStale(p, now)),
    unread: pages.filter((p) => p.kind !== "database" && now - p.createdAt.getTime() > 7 * DAY && !usage.get(p.id)?.runs),
    room: Math.max(0, 1 - fullest),
    usage,
  };
}

/** A page's size as teammates get it, against the per-page prompt budget. */
export function promptSize(page: Pick<ContextPage, "kind" | "body">) {
  return { chars: pageForAgents(page).length, max: PROMPT_BUDGET.perPage };
}

/** Who changed a page lately: decided suggestions (newest first) and the last edit. */
export function pageHistory(businessId: string, pageId: string, names: Map<string, string>) {
  return db
    .select()
    .from(schema.contextSuggestions)
    .where(and(eq(schema.contextSuggestions.businessId, businessId), eq(schema.contextSuggestions.pageId, pageId)))
    .all()
    .filter((s) => s.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).getTime() - (a.decidedAt ?? a.createdAt).getTime())
    .slice(0, 5)
    .map((s) => ({ id: s.id, status: s.status, author: s.teammateId ? (names.get(s.teammateId) ?? null) : null, kind: s.kind, at: (s.decidedAt ?? s.createdAt).toISOString() }));
}

export function readersFor(page: ContextPage, mates: { id: string }[], rows: ReturnType<typeof readerRows>) {
  return mates.map((m) => ({ teammateId: m.id, mode: readerMode(page, m.id, rows) }));
}

export function suggestionView(s: ContextSuggestion, page: ContextPage | undefined, names: Map<string, string>, managerId: string | null): SuggestionView {
  const current = page?.body ?? "";
  const after = s.kind === "new_page" ? s.body : s.kind === "delete" ? "" : s.kind === "append" ? `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${s.body.trim()}` : s.body;
  const reorganize = isReorganizeSource(s.source);
  return {
    id: s.id,
    kind: s.kind,
    pageId: s.pageId,
    pageTitle: page?.title ?? null,
    reorganize,
    author: s.teammateId ? (names.get(s.teammateId) ?? null) : null,
    authorId: s.teammateId,
    fromChat: !!managerId && s.teammateId === managerId && !!s.taskId,
    reason: s.reason,
    // A review's marker isn't a source to show.
    source: reorganize ? "" : s.source,
    createdAt: s.createdAt.toISOString(),
    body: s.body,
    title: s.title,
    section: s.section,
    changedSince: (s.kind === "replace" || s.kind === "delete") && s.before !== null && page !== undefined && normalizeMarkdown(s.before) !== normalizeMarkdown(page.body),
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
