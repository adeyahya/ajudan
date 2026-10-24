import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, gt, isNotNull, isNull, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { describeRef, type ObjectRef, type RefInfo } from "@/lib/links";
import { dataDir } from "@/lib/paths";

/**
 * Home's data (src/app/b/[id]/home): what the owner touched lately, the "New from the team"
 * review queue and starred files. The review queue shows what teammates made since the
 * owner last cleared it ("Mark all as seen"), minus what they already kept; that state
 * lives in <folder>/home-review.json, keyed by business (no schema change for a UI marker).
 */

export type HomeItem = RefInfo & { at: Date; by: string };

const DAY = 24 * 60 * 60 * 1000;
/** Before the owner ever clears the queue, it goes back this far. */
const FIRST_LOOK_DAYS = 7;
const MAX_KEPT = 500;

type ReviewState = { since: number; kept: string[] };
const stateFile = () => path.join(dataDir(), "home-review.json");
export const refKey = (r: ObjectRef) => `${r.type}:${r.id}`;

function readAll(): Record<string, ReviewState> {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as Record<string, ReviewState>;
  } catch {
    return {};
  }
}

function writeState(businessId: string, s: ReviewState) {
  const all = readAll();
  all[businessId] = { since: s.since, kept: s.kept.slice(-MAX_KEPT) };
  fs.writeFileSync(stateFile(), JSON.stringify(all, null, 2));
}

export function reviewState(businessId: string, now = Date.now()): ReviewState {
  const s = readAll()[businessId];
  return { since: typeof s?.since === "number" ? s.since : now - FIRST_LOOK_DAYS * DAY, kept: Array.isArray(s?.kept) ? s.kept : [] };
}

/** Keep (dismiss) one item from the review queue. */
export function keepReviewItem(businessId: string, ref: ObjectRef) {
  const s = reviewState(businessId);
  if (!s.kept.includes(refKey(ref))) s.kept.push(refKey(ref));
  writeState(businessId, s);
}

/** Clear the review queue: only what teammates make from now on shows up. */
export function markReviewSeen(businessId: string, at = Date.now()) {
  writeState(businessId, { since: at, kept: [] });
}

const isTeammate = (by: string | null | undefined): by is string => !!by && by.startsWith("teammate:");

/**
 * What teammates made since the queue was last cleared, newest first: docs (deliverables),
 * Context pages, library files and contacts with created_by "teammate:<id>", leaving Trash
 * and kept items out.
 */
export function newFromTeam(businessId: string, opts: { since?: number; kept?: string[]; limit?: number } = {}): HomeItem[] {
  const state = opts.since === undefined || opts.kept === undefined ? reviewState(businessId) : undefined;
  const since = new Date(opts.since ?? state!.since);
  const kept = new Set(opts.kept ?? state!.kept);
  const d = schema.deliverables;
  const p = schema.contextPages;
  const a = schema.assets;
  const c = schema.contacts;
  const found: { ref: ObjectRef; at: Date; by: string }[] = [
    // Rows from before created_by say who made them through teammate_id.
    ...db
      .select({ id: d.id, at: d.createdAt, by: d.createdBy, mate: d.teammateId })
      .from(d)
      .where(
        and(
          eq(d.businessId, businessId),
          isNull(d.deletedAt),
          gt(d.createdAt, since),
          or(like(d.createdBy, "teammate:%"), and(isNull(d.createdBy), isNotNull(d.teammateId))),
        ),
      )
      .all()
      .map((r) => ({ ref: { type: "deliverable" as const, id: r.id }, at: r.at, by: r.by ?? `teammate:${r.mate}` })),
    ...db
      .select({ id: p.id, at: p.createdAt, by: p.createdBy })
      .from(p)
      .where(and(eq(p.businessId, businessId), isNull(p.deletedAt), gt(p.createdAt, since), like(p.createdBy, "teammate:%")))
      .all()
      .map((r) => ({ ref: { type: "doc" as const, id: r.id }, at: r.at, by: r.by })),
    ...db
      .select({ id: a.path, at: a.createdAt, by: a.createdBy })
      .from(a)
      .where(and(eq(a.businessId, businessId), isNull(a.deletedAt), gt(a.createdAt, since), like(a.createdBy, "teammate:%")))
      .all()
      .map((r) => ({ ref: { type: "asset" as const, id: r.id }, at: r.at, by: r.by })),
    ...db
      .select({ id: c.id, at: c.createdAt, by: c.createdBy })
      .from(c)
      .where(and(eq(c.businessId, businessId), isNull(c.deletedAt), gt(c.createdAt, since), like(c.createdBy, "teammate:%")))
      .all()
      .map((r) => ({ ref: { type: "contact" as const, id: r.id }, at: r.at, by: r.by })),
  ];
  return found
    .filter((f) => isTeammate(f.by) && !kept.has(refKey(f.ref)))
    .sort((x, y) => y.at.getTime() - x.at.getTime())
    .slice(0, opts.limit ?? 50)
    .flatMap((f) => {
      const info = describeRef(businessId, f.ref);
      return info && !info.deleted ? [{ ...info, at: f.at, by: f.by }] : [];
    });
}

/**
 * What the owner worked on lately, newest first, one row per object: their changes in
 * object_history, Context pages they last edited, and docs and contacts they made.
 */
export function recentForOwner(businessId: string, limit = 8): HomeItem[] {
  const h = schema.objectHistory;
  const p = schema.contextPages;
  const d = schema.deliverables;
  const c = schema.contacts;
  const scan = limit * 4;
  const candidates: { ref: ObjectRef; at: Date }[] = [
    ...db
      .select({ type: h.objectType, id: h.objectId, at: h.createdAt })
      .from(h)
      .where(and(eq(h.businessId, businessId), eq(h.by, "owner")))
      .orderBy(desc(h.createdAt))
      .limit(scan)
      .all()
      .map((r) => ({ ref: { type: r.type, id: r.id }, at: r.at })),
    ...db
      .select({ id: p.id, at: p.updatedAt })
      .from(p)
      .where(and(eq(p.businessId, businessId), isNull(p.deletedAt), eq(p.updatedBy, "owner"), isNotNull(p.updatedAt)))
      .orderBy(desc(p.updatedAt))
      .limit(limit)
      .all()
      .map((r) => ({ ref: { type: "doc" as const, id: r.id }, at: r.at! })),
    ...db
      .select({ id: d.id, at: d.createdAt })
      .from(d)
      .where(and(eq(d.businessId, businessId), isNull(d.deletedAt), eq(d.createdBy, "owner")))
      .orderBy(desc(d.createdAt))
      .limit(limit)
      .all()
      .map((r) => ({ ref: { type: "deliverable" as const, id: r.id }, at: r.at })),
    ...db
      .select({ id: c.id, at: c.createdAt })
      .from(c)
      .where(and(eq(c.businessId, businessId), isNull(c.deletedAt), eq(c.createdBy, "owner")))
      .orderBy(desc(c.createdAt))
      .limit(limit)
      .all()
      .map((r) => ({ ref: { type: "contact" as const, id: r.id }, at: r.at })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());

  const seen = new Set<string>();
  const out: HomeItem[] = [];
  for (const cand of candidates) {
    if (out.length >= limit) break;
    const key = refKey(cand.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const info = describeRef(businessId, cand.ref);
    if (info && !info.deleted) out.push({ ...info, at: cand.at, by: "owner" });
  }
  return out;
}

/** Starred library files (not in Trash), most recently organized first. */
export function starredItems(businessId: string, limit = 12): HomeItem[] {
  const a = schema.assets;
  return db
    .select({ id: a.path, at: a.createdAt, by: a.updatedBy })
    .from(a)
    .where(and(eq(a.businessId, businessId), isNull(a.deletedAt), eq(a.starred, true)))
    .orderBy(desc(a.createdAt))
    .limit(limit)
    .all()
    .flatMap((r) => {
      const info = describeRef(businessId, { type: "asset", id: r.id });
      return info ? [{ ...info, at: r.at, by: r.by }] : [];
    });
}
