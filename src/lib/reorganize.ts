import { and, desc, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ContextPage, ContextSection, SuggestionKind } from "@/db/schema";
import { normalizeMarkdown, SECTIONS } from "@/lib/context-text";
import { enqueueJob } from "@/lib/jobs";

/**
 * "Reorganize with AI" for the Context workspace. The worker has an agent read every page
 * (and what teammates keep in memory.md) and propose a tidier layout: merge duplicates,
 * split oversized pages, retitle, move to a better section, drop stale facts, and promote
 * durable facts stuck in a teammate's memory to a page. Nothing is rewritten silently:
 * each change becomes a context suggestion (src/lib/context.ts) the owner accepts or
 * rejects on /b/[id]/context/organize. This file holds the parts without Claude: the
 * plan → suggestions mapping, the run's state, and when a weekly review is due.
 */

/** Suggestions from a review carry `source: "reorganize:<jobId>"`. */
export const REORGANIZE_SOURCE = "reorganize:";
export const isReorganizeSource = (source: string) => source.startsWith(REORGANIZE_SOURCE);

export const REORGANIZE_EVERY_MS = 7 * 24 * 3600 * 1000;
const MAX_OPS = 25;

export const REORGANIZE_ACTIONS = ["merge", "split", "retitle", "move", "rewrite", "delete", "append", "new_page"] as const;

/** One step of the agent's plan (the shape its output schema asks for). */
export type ReorganizeOp = {
  action: (typeof REORGANIZE_ACTIONS)[number];
  /** Page id (or exact title): the page that changes; for merge, the one that stays. */
  page?: string;
  /** merge: the pages folded into `page` (removed once accepted). */
  merge_from?: string[];
  title?: string;
  section?: ContextSection;
  /** merge/split/rewrite: the page's whole new text; append: what to add; new_page: its text. */
  markdown?: string;
  /** split: the pages that take the parts moved out. */
  new_pages?: { title: string; section?: ContextSection; markdown: string }[];
  reason: string;
};

export type PlannedSuggestion = {
  kind: SuggestionKind;
  page?: ContextPage;
  body: string;
  title?: string;
  section?: ContextSection;
  reason: string;
};

/**
 * The agent's plan as suggestions, keeping only what's safe and makes sense: pages that
 * exist (by id or exact title), each page in at most one step, no step on a database
 * page, Ajudan's own pages (with a `key`) never removed, merged away or moved, no
 * "rewrite" that changes nothing, and at most 25 steps.
 */
export function planSuggestions(pages: ContextPage[], ops: ReorganizeOp[]): PlannedSuggestion[] {
  const find = (ref?: string) => {
    if (!ref) return undefined;
    const r = ref.trim();
    return pages.find((p) => p.id === r) ?? pages.find((p) => p.title.trim().toLowerCase() === r.toLowerCase());
  };
  const used = new Set<string>();
  const titles = new Set(pages.map((p) => p.title.trim().toLowerCase()));
  const section = (s?: ContextSection) => (s && SECTIONS.includes(s) ? s : undefined);
  const out: PlannedSuggestion[] = [];

  for (const op of ops.slice(0, MAX_OPS)) {
    const reason = (op.reason ?? "").trim();
    const md = op.markdown?.trim() ?? "";
    const title = op.title?.trim().slice(0, 120) || undefined;

    if (op.action === "new_page") {
      if (!title || !md || titles.has(title.toLowerCase())) continue;
      titles.add(title.toLowerCase());
      out.push({ kind: "new_page", body: `${md}\n`, title, section: section(op.section) ?? "team_written", reason });
      continue;
    }

    const page = find(op.page);
    if (!page || page.kind !== "page" || used.has(page.id)) continue;

    if (op.action === "append") {
      if (!md) continue;
      used.add(page.id);
      out.push({ kind: "append", page, body: md, reason });
      continue;
    }

    if (op.action === "delete") {
      if (page.key) continue;
      used.add(page.id);
      out.push({ kind: "delete", page, body: "", reason });
      continue;
    }

    // Everything else replaces the page (its text, title and/or section).
    const newTitle = title && title !== page.title ? title : undefined;
    const newSection = page.key ? undefined : section(op.section) !== page.section ? section(op.section) : undefined;
    const keepsText = op.action === "retitle" || op.action === "move";
    const body = keepsText || !md ? page.body : `${md}\n`;
    const changesText = normalizeMarkdown(body) !== normalizeMarkdown(page.body);

    if (op.action === "merge") {
      const from = (op.merge_from ?? []).map(find).filter((p): p is ContextPage => !!p && p.kind === "page" && !p.key && p.id !== page.id && !used.has(p.id));
      if (!from.length || !md) continue;
      used.add(page.id);
      for (const p of from) used.add(p.id);
      out.push({ kind: "replace", page, body, title: newTitle, section: newSection, reason });
      for (const p of from) out.push({ kind: "delete", page: p, body: "", reason: `Merged into "${newTitle ?? page.title}". ${reason}`.trim() });
      continue;
    }

    if (op.action === "split") {
      const parts = (op.new_pages ?? []).filter((n) => n.title?.trim() && n.markdown?.trim() && !titles.has(n.title.trim().toLowerCase()));
      if (!parts.length || !md) continue;
      used.add(page.id);
      out.push({ kind: "replace", page, body, title: newTitle, section: newSection, reason });
      for (const n of parts) {
        const t = n.title.trim().slice(0, 120);
        titles.add(t.toLowerCase());
        out.push({ kind: "new_page", body: `${n.markdown.trim()}\n`, title: t, section: section(n.section) ?? page.section, reason: `Split out of "${page.title}". ${reason}`.trim() });
      }
      continue;
    }

    // retitle, move, rewrite: skip steps that change nothing.
    if (!changesText && !newTitle && !newSection) continue;
    used.add(page.id);
    out.push({ kind: "replace", page, body, title: newTitle, section: newSection, reason });
  }
  return out;
}

// ---- runs ----

function reorganizeJobs(businessId: string) {
  return db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.kind, "context_reorganize"), sql`json_extract(${schema.jobs.payload}, '$.businessId') = ${businessId}`))
    .orderBy(desc(schema.jobs.id));
}

/** The latest review (queued, running, done or failed), the schedule, and how many of its suggestions wait. */
export function reorganizeState(businessId: string) {
  const job = reorganizeJobs(businessId).limit(1).get();
  const biz = db.select({ tidy: schema.businesses.contextTidy, at: schema.businesses.contextTidiedAt }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  const pending = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.contextSuggestions)
    .where(and(eq(schema.contextSuggestions.businessId, businessId), eq(schema.contextSuggestions.status, "pending"), like(schema.contextSuggestions.source, `${REORGANIZE_SOURCE}%`)))
    .get();
  return {
    job: job ? { id: job.id, status: job.status, error: job.error, createdAt: job.createdAt, finishedAt: job.finishedAt } : null,
    weekly: biz?.tidy === "weekly",
    lastRunAt: biz?.at ?? null,
    pending: pending?.n ?? 0,
  };
}

/** Queue a review unless one is already waiting or running. Returns the job id, or null. */
export function requestReorganize(businessId: string, auto = false) {
  const busy = reorganizeJobs(businessId).all().find((j) => j.status === "queued" || j.status === "running");
  if (busy) return null;
  return enqueueJob("context_reorganize", { businessId, auto });
}

/** Businesses whose weekly review is due (the worker's hourly check). */
export function dueReorganizeBusinesses(now = Date.now()) {
  return db
    .select({ id: schema.businesses.id, at: schema.businesses.contextTidiedAt })
    .from(schema.businesses)
    .where(and(eq(schema.businesses.contextTidy, "weekly"), eq(schema.businesses.status, "active")))
    .all()
    .filter((b) => !b.at || now - b.at.getTime() >= REORGANIZE_EVERY_MS)
    .map((b) => b.id);
}

/** A new review replaces the previous one's undecided suggestions. */
export function supersedeReorganize(businessId: string) {
  db.update(schema.contextSuggestions)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(schema.contextSuggestions.businessId, businessId), eq(schema.contextSuggestions.status, "pending"), like(schema.contextSuggestions.source, `${REORGANIZE_SOURCE}%`)))
    .run();
}

/** The pending suggestions from reviews, oldest first. */
export function pendingReorganize(businessId: string) {
  return db
    .select()
    .from(schema.contextSuggestions)
    .where(and(eq(schema.contextSuggestions.businessId, businessId), eq(schema.contextSuggestions.status, "pending"), like(schema.contextSuggestions.source, `${REORGANIZE_SOURCE}%`)))
    // Insertion order: a merge's "remove" steps follow the page they fold into.
    .orderBy(sql`rowid`)
    .all();
}

export function setReorganizeSchedule(businessId: string, weekly: boolean) {
  db.update(schema.businesses).set({ contextTidy: weekly ? "weekly" : null }).where(eq(schema.businesses.id, businessId)).run();
}
