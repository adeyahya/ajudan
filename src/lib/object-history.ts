import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, gt, inArray, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { HistoryAction, ObjectType } from "@/db/schema";
import { dataDir } from "@/lib/paths";
import { removeDeliverableFile, syncDeliverableFile } from "@/lib/workfiles";

/**
 * A snapshot of a workspace object per change, with who made it ("owner", "system" or
 * "teammate:<id>"). Trash records "delete"/"restore" (src/lib/trash.ts); editors and
 * teammate tools record "create"/"update". The snapshot is always the object AFTER the
 * change (a version: "Restore this version" writes it back). An update can also carry the
 * state before it under `snapshot.before`; teammate updates always do, and Undo in the
 * Inbox writes that back. restoreVersion() records a "restore" the same way (snapshot =
 * the restored state, before = what it replaced), so a restore can be undone too.
 */

export type { HistoryAction, ObjectType };
export type HistoryEntry = typeof schema.objectHistory.$inferSelect;

/** JSON-safe copy of a row (Dates become ISO strings, as JSON.stringify would write them). */
export function toSnapshot(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

export function recordHistory(v: {
  businessId: string;
  type: ObjectType;
  id: string;
  /** The object after the change. */
  snapshot: object;
  /** The object before the change (updates), so the change can be undone. */
  before?: object | null;
  action: HistoryAction;
  by: string;
}) {
  const snapshot = toSnapshot(v.snapshot);
  delete snapshot.before;
  if (v.before) {
    const before = toSnapshot(v.before);
    delete before.before;
    snapshot.before = before;
  }
  return db
    .insert(schema.objectHistory)
    .values({ businessId: v.businessId, objectType: v.type, objectId: v.id, snapshot, action: v.action, by: v.by })
    .returning()
    .get();
}

/** One object's history, newest first. */
export function historyFor(businessId: string, type: ObjectType, id: string, limit = 100): HistoryEntry[] {
  return db
    .select()
    .from(schema.objectHistory)
    .where(and(eq(schema.objectHistory.businessId, businessId), eq(schema.objectHistory.objectType, type), eq(schema.objectHistory.objectId, id)))
    .orderBy(desc(schema.objectHistory.createdAt))
    .limit(limit)
    .all();
}

/** Recent changes across the business, newest first (for an activity feed). */
export function recentHistory(businessId: string, limit = 50): HistoryEntry[] {
  return db
    .select()
    .from(schema.objectHistory)
    .where(eq(schema.objectHistory.businessId, businessId))
    .orderBy(desc(schema.objectHistory.createdAt))
    .limit(limit)
    .all();
}

export function getHistoryEntry(businessId: string, historyId: string): HistoryEntry | undefined {
  return db
    .select()
    .from(schema.objectHistory)
    .where(and(eq(schema.objectHistory.id, historyId), eq(schema.objectHistory.businessId, businessId)))
    .get();
}

/** Recent changes by teammates ("teammate:<id>"), newest first: the Inbox's undo list. */
export function recentTeamHistory(businessId: string, limit = 20): HistoryEntry[] {
  return db
    .select()
    .from(schema.objectHistory)
    .where(and(eq(schema.objectHistory.businessId, businessId), like(schema.objectHistory.by, "teammate:%")))
    .orderBy(desc(schema.objectHistory.createdAt))
    .limit(limit)
    .all();
}

/** Of these entries, the ids of those something newer happened to since (a later entry on the same object). */
export function supersededIds(businessId: string, entries: HistoryEntry[]): Set<string> {
  if (!entries.length) return new Set();
  const h = schema.objectHistory;
  const oldest = new Date(Math.min(...entries.map((e) => e.createdAt.getTime())));
  const later = db
    .select({ id: h.id, type: h.objectType, objectId: h.objectId, createdAt: h.createdAt })
    .from(h)
    .where(and(eq(h.businessId, businessId), gt(h.createdAt, oldest), inArray(h.objectId, [...new Set(entries.map((e) => e.objectId))])))
    .all();
  const out = new Set<string>();
  for (const e of entries) {
    const newer = later.some((l) => l.id !== e.id && l.type === e.objectType && l.objectId === e.objectId && l.createdAt.getTime() > e.createdAt.getTime());
    if (newer) out.add(e.id);
  }
  return out;
}

/** Who made a change, for display: "owner", "system", or a teammate with their name (or "teammate" when they're gone). */
export type Actor = { kind: "owner" | "system" | "teammate"; name?: string; teammateId?: string; color?: string };

/** A resolver from "owner" / "system" / "teammate:<id>" to an Actor, with the business's teammate names read once. */
export function actorResolver(businessId: string): (by: string | null | undefined) => Actor {
  const mates = new Map(
    db
      .select({ id: schema.teammates.id, name: schema.teammates.name, color: schema.teammates.color })
      .from(schema.teammates)
      .where(eq(schema.teammates.businessId, businessId))
      .all()
      .map((m) => [m.id, m]),
  );
  return (by) => {
    if (by?.startsWith("teammate:")) {
      const teammateId = by.slice("teammate:".length);
      const m = mates.get(teammateId);
      return { kind: "teammate", teammateId, name: m?.name, color: m?.color };
    }
    return { kind: by === "system" ? "system" : "owner" };
  };
}

/* ------------------------------------------------------------------ restore */

/** A file's organization before anyone labeled it: the `before` of a first labels row. */
export const NO_LABELS = { title: "", note: "", tags: [] as string[], album: null, starred: false };

/** Object types whose snapshots restoreVersion() can write back, and the fields it writes. */
const EDITABLE = {
  deliverable: ["title", "content", "kind", "channel", "status", "attachments", "folder"],
  contact: ["name", "phone", "email", "company", "kind", "tags", "notes", "followUpAt", "followUpNote", "fields"],
  doc: ["title", "body", "blocks", "icon", "cover"],
  /** Only the library's organization: the file itself isn't versioned. */
  asset: ["title", "note", "tags", "album", "starred"],
} as const;

type RestorableType = keyof typeof EDITABLE;
const DATE_FIELDS = new Set<string>(["followUpAt"]);

const isRestorable = (type: ObjectType): type is RestorableType => type in EDITABLE;

/** The editable fields a snapshot holds (dates revived), or null when it holds none. */
function editableFields(type: RestorableType, snapshot: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE[type]) {
    if (!(f in snapshot)) continue;
    const v = snapshot[f];
    out[f] = DATE_FIELDS.has(f) && typeof v === "string" ? new Date(v) : v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Whether the Inbox can undo this teammate change: an update with a restorable snapshot,
 * or something they made or deleted (Trash takes or gives it back).
 */
export function canUndoEntry(e: Pick<HistoryEntry, "action" | "objectType" | "snapshot">) {
  if (e.action === "update") return isRestorable(e.objectType) && !!editableFields(e.objectType, beforeOf(e.snapshot));
  return (e.action === "create" || e.action === "delete") && e.objectType !== "task";
}

function beforeOf(snapshot: Record<string, unknown>): Record<string, unknown> {
  const b = snapshot.before;
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

/** Whether "Restore this version" makes sense for this entry. */
export function canRestoreEntry(e: Pick<HistoryEntry, "objectType" | "snapshot">) {
  return isRestorable(e.objectType) && !!editableFields(e.objectType, e.snapshot);
}

function currentRow(businessId: string, type: RestorableType, id: string) {
  switch (type) {
    case "deliverable":
      return db.select().from(schema.deliverables).where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.businessId, businessId))).get();
    case "contact":
      return db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.businessId, businessId))).get();
    case "doc":
      return db.select().from(schema.contextPages).where(and(eq(schema.contextPages.id, id), eq(schema.contextPages.businessId, businessId))).get();
    case "asset":
      return db.select().from(schema.assets).where(and(eq(schema.assets.path, id), eq(schema.assets.businessId, businessId))).get();
  }
}

/**
 * Put a history entry's snapshot back: its editable fields only (not Trash state, ids or
 * who made it). Records a "restore" by `by` holding the state it replaced. False when the
 * entry is unknown, its type isn't restorable, the snapshot holds nothing editable, or the
 * object is gone for good.
 */
export function restoreVersion(businessId: string, historyId: string, by = "owner", which: "version" | "before" = "version"): boolean {
  const entry = getHistoryEntry(businessId, historyId);
  if (!entry || !isRestorable(entry.objectType)) return false;
  const type = entry.objectType;
  const id = entry.objectId;
  const fields = editableFields(type, which === "before" ? beforeOf(entry.snapshot) : entry.snapshot);
  if (!fields) return false;
  const before = currentRow(businessId, type, id);
  switch (type) {
    case "deliverable":
      if (!before) return false;
      db.update(schema.deliverables).set({ ...fields, updatedBy: by }).where(eq(schema.deliverables.id, id)).run();
      // The work/*.md mirror is named after the title: write it again under the restored one.
      removeDeliverableFile(id);
      syncDeliverableFile(id);
      break;
    case "contact":
      if (!before) return false;
      db.update(schema.contacts).set({ ...fields, updatedBy: by }).where(eq(schema.contacts.id, id)).run();
      break;
    case "doc":
      if (!before) return false;
      db.update(schema.contextPages).set({ ...fields, updatedBy: by, updatedAt: new Date() }).where(eq(schema.contextPages.id, id)).run();
      break;
    case "asset": {
      if (!before && !fs.existsSync(path.join(dataDir(), id))) return false;
      const t = schema.assets;
      db.insert(t)
        .values({ path: id, businessId, ...fields, createdBy: by, updatedBy: by })
        .onConflictDoUpdate({ target: t.path, set: { ...fields, updatedBy: by } })
        .run();
      break;
    }
  }
  recordHistory({ businessId, type, id, snapshot: currentRow(businessId, type, id) ?? { path: id, ...fields }, before, action: "restore", by });
  return true;
}
