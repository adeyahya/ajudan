import fs from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ObjectType } from "@/db/schema";
import { purgeFromLibrary } from "@/lib/assets";
import { removeLinksFor } from "@/lib/links";
import { recordHistory } from "@/lib/object-history";
import { dataDir } from "@/lib/paths";
import { removeDeliverableFile, syncDeliverableFile } from "@/lib/workfiles";

/**
 * Trash: soft delete for docs (Context pages), deliverables, library files and contacts.
 * Deleting sets `deleted_at` (and `updated_by`), and every list, search and teammate tool
 * leaves those rows out; restoring clears it. A library file stays where it is on disk
 * (an assets row with deleted_at hides it); a deliverable's work/*.md mirror is removed
 * and written again on restore. Purging deletes for good (library: the file too) and drops
 * the object's links. Delete and restore are recorded in object_history.
 */

export type TrashType = Exclude<ObjectType, "task">;
export const TRASH_TYPES: TrashType[] = ["doc", "deliverable", "asset", "contact"];

export type TrashItem = { type: TrashType; id: string; title: string; deletedAt: Date; deletedBy: string };

const now = () => new Date();

/** The object's row, live or trashed. */
function readRow(businessId: string, type: TrashType, id: string) {
  switch (type) {
    case "doc":
      return db.select().from(schema.contextPages).where(and(eq(schema.contextPages.id, id), eq(schema.contextPages.businessId, businessId))).get();
    case "deliverable":
      return db.select().from(schema.deliverables).where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.businessId, businessId))).get();
    case "contact":
      return db.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.businessId, businessId))).get();
    case "asset":
      return db.select().from(schema.assets).where(and(eq(schema.assets.path, id), eq(schema.assets.businessId, businessId))).get();
  }
}

/**
 * Move an object to Trash. False when it isn't there, is already in Trash, or can't be
 * deleted (Ajudan's own Context pages, which have a `key`). Callers check ownership.
 */
export function softDelete(businessId: string, type: TrashType, id: string, by = "owner"): boolean {
  const at = now();
  let done = false;
  switch (type) {
    case "doc": {
      const t = schema.contextPages;
      done = !!db
        .update(t)
        .set({ deletedAt: at, updatedBy: by })
        .where(and(eq(t.id, id), eq(t.businessId, businessId), isNull(t.deletedAt), isNull(t.key)))
        .returning({ id: t.id })
        .get();
      break;
    }
    case "deliverable": {
      const t = schema.deliverables;
      done = !!db
        .update(t)
        .set({ deletedAt: at, updatedBy: by })
        .where(and(eq(t.id, id), eq(t.businessId, businessId), isNull(t.deletedAt)))
        .returning({ id: t.id })
        .get();
      if (done) removeDeliverableFile(id);
      break;
    }
    case "contact": {
      const t = schema.contacts;
      done = !!db
        .update(t)
        .set({ deletedAt: at, updatedBy: by })
        .where(and(eq(t.id, id), eq(t.businessId, businessId), isNull(t.deletedAt)))
        .returning({ id: t.id })
        .get();
      break;
    }
    case "asset": {
      // Files without a row get one, so the library knows to hide them.
      const t = schema.assets;
      const cur = readRow(businessId, "asset", id);
      if (cur?.deletedAt) return false;
      if (!cur && !fs.existsSync(path.join(dataDir(), id))) return false;
      db.insert(t)
        .values({ path: id, businessId, deletedAt: at, updatedBy: by })
        .onConflictDoUpdate({ target: t.path, set: { deletedAt: at, updatedBy: by } })
        .run();
      done = true;
      break;
    }
  }
  if (done) recordHistory({ businessId, type, id, snapshot: readRow(businessId, type, id) ?? { id }, action: "delete", by });
  return done;
}

/**
 * Take an object out of Trash. A Context page whose old parent is gone (or in Trash)
 * comes back at the top of its section. False when it wasn't in Trash.
 */
export function restoreFromTrash(businessId: string, type: TrashType, id: string, by = "owner"): boolean {
  const row = readRow(businessId, type, id);
  if (!row?.deletedAt) return false;
  switch (type) {
    case "doc": {
      const t = schema.contextPages;
      const page = row as typeof t.$inferSelect;
      const parentLive =
        page.parentId && db.select({ id: t.id }).from(t).where(and(eq(t.id, page.parentId), eq(t.businessId, businessId), isNull(t.deletedAt))).get();
      db.update(t)
        .set({ deletedAt: null, updatedBy: by, updatedAt: now(), ...(page.parentId && !parentLive ? { parentId: null } : {}) })
        .where(eq(t.id, id))
        .run();
      break;
    }
    case "deliverable":
      db.update(schema.deliverables).set({ deletedAt: null, updatedBy: by }).where(eq(schema.deliverables.id, id)).run();
      syncDeliverableFile(id);
      break;
    case "contact":
      db.update(schema.contacts).set({ deletedAt: null, updatedBy: by }).where(eq(schema.contacts.id, id)).run();
      break;
    case "asset":
      db.update(schema.assets)
        .set({ deletedAt: null, updatedBy: by })
        .where(and(eq(schema.assets.path, id), eq(schema.assets.businessId, businessId)))
        .run();
      break;
  }
  recordHistory({ businessId, type, id, snapshot: readRow(businessId, type, id) ?? { id }, action: "restore", by });
  return true;
}

/** Delete an object in Trash for good (a library file from disk too). False when it isn't in Trash. */
export function purge(businessId: string, type: TrashType, id: string): boolean {
  const row = readRow(businessId, type, id);
  if (!row?.deletedAt) return false;
  switch (type) {
    case "doc":
      // Sub-pages moved up when it went to Trash; any still pointing here come up now.
      db.update(schema.contextPages).set({ parentId: null }).where(and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.parentId, id))).run();
      db.delete(schema.contextPages).where(eq(schema.contextPages.id, id)).run();
      break;
    case "deliverable":
      db.delete(schema.deliverables).where(eq(schema.deliverables.id, id)).run();
      removeDeliverableFile(id);
      break;
    case "contact":
      db.delete(schema.contacts).where(eq(schema.contacts.id, id)).run();
      break;
    case "asset":
      purgeFromLibrary(businessId, [id]);
      break;
  }
  removeLinksFor(businessId, { type, id });
  return true;
}

/** Delete for good everything in Trash for longer than `days` (worker/maintenance.ts, daily). Returns how many. */
export function purgeOlderThan(businessId: string, days: number): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let n = 0;
  for (const item of listTrash(businessId)) {
    if (item.deletedAt.getTime() < cutoff && purge(businessId, item.type, item.id)) n++;
  }
  return n;
}

/** Purge everything in Trash. Returns how many. */
export function emptyTrash(businessId: string): number {
  let n = 0;
  for (const item of listTrash(businessId)) if (purge(businessId, item.type, item.id)) n++;
  return n;
}

/** Everything in Trash, most recently deleted first. */
export function listTrash(businessId: string): TrashItem[] {
  const p = schema.contextPages;
  const d = schema.deliverables;
  const c = schema.contacts;
  const a = schema.assets;
  const items: TrashItem[] = [
    ...db
      .select({ id: p.id, title: p.title, deletedAt: p.deletedAt, by: p.updatedBy })
      .from(p)
      .where(and(eq(p.businessId, businessId), isNotNull(p.deletedAt)))
      .all()
      .map((r) => ({ type: "doc" as const, id: r.id, title: r.title, deletedAt: r.deletedAt!, deletedBy: r.by })),
    ...db
      .select({ id: d.id, title: d.title, deletedAt: d.deletedAt, by: d.updatedBy })
      .from(d)
      .where(and(eq(d.businessId, businessId), isNotNull(d.deletedAt)))
      .all()
      .map((r) => ({ type: "deliverable" as const, id: r.id, title: r.title, deletedAt: r.deletedAt!, deletedBy: r.by ?? "owner" })),
    ...db
      .select({ id: c.id, title: c.name, deletedAt: c.deletedAt, by: c.updatedBy })
      .from(c)
      .where(and(eq(c.businessId, businessId), isNotNull(c.deletedAt)))
      .all()
      .map((r) => ({ type: "contact" as const, id: r.id, title: r.title, deletedAt: r.deletedAt!, deletedBy: r.by })),
    ...db
      .select({ id: a.path, title: a.title, deletedAt: a.deletedAt, by: a.updatedBy })
      .from(a)
      .where(and(eq(a.businessId, businessId), isNotNull(a.deletedAt)))
      .all()
      .map((r) => ({ type: "asset" as const, id: r.id, title: r.title || path.posix.basename(r.id), deletedAt: r.deletedAt!, deletedBy: r.by })),
  ];
  return items.sort((x, y) => y.deletedAt.getTime() - x.deletedAt.getTime());
}
