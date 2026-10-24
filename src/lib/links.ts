import path from "node:path";
import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ObjectType } from "@/db/schema";

/**
 * Links between workspace objects (the `links` table): any object to any object, stored
 * once as from → to. Backlinks are the same rows read from the `to` side. Ids: a Context
 * page's id for "doc", a deliverables id, a library path ("media/…") for "asset", a
 * contact id, a task id.
 */

export type { ObjectType };
export type ObjectRef = { type: ObjectType; id: string };
export type Link = typeof schema.links.$inferSelect;
/** A linked object seen from one side: `out` when this side made the link (from), `in` for a backlink. */
export type LinkedRef = ObjectRef & { direction: "out" | "in"; linkId: string; createdBy: string; createdAt: Date };

export const OBJECT_TYPES: ObjectType[] = ["doc", "deliverable", "asset", "contact", "task"];

const sameRef = (a: ObjectRef, b: ObjectRef) => a.type === b.type && a.id === b.id;

/** Link `from` → `to`. Returns the link (the existing one when it's already there), or null for a self-link. */
export function addLink(businessId: string, from: ObjectRef, to: ObjectRef, by = "owner"): Link | null {
  if (sameRef(from, to)) return null;
  const row = db
    .insert(schema.links)
    .values({ businessId, fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, createdBy: by })
    .onConflictDoNothing()
    .returning()
    .get();
  return (
    row ??
    db
      .select()
      .from(schema.links)
      .where(
        and(
          eq(schema.links.businessId, businessId),
          eq(schema.links.fromType, from.type),
          eq(schema.links.fromId, from.id),
          eq(schema.links.toType, to.type),
          eq(schema.links.toId, to.id),
        ),
      )
      .get() ??
    null
  );
}

/** Remove the link `from` → `to` (only that direction). True when one was removed. */
export function removeLink(businessId: string, from: ObjectRef, to: ObjectRef) {
  return !!db
    .delete(schema.links)
    .where(
      and(
        eq(schema.links.businessId, businessId),
        eq(schema.links.fromType, from.type),
        eq(schema.links.fromId, from.id),
        eq(schema.links.toType, to.type),
        eq(schema.links.toId, to.id),
      ),
    )
    .returning({ id: schema.links.id })
    .get();
}

const fromSide = (ref: ObjectRef) => and(eq(schema.links.fromType, ref.type), eq(schema.links.fromId, ref.id));
const toSide = (ref: ObjectRef) => and(eq(schema.links.toType, ref.type), eq(schema.links.toId, ref.id));

/** What this object links to. */
export function linksFrom(businessId: string, ref: ObjectRef): LinkedRef[] {
  return db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.businessId, businessId), fromSide(ref)))
    .all()
    .map((l) => ({ type: l.toType, id: l.toId, direction: "out" as const, linkId: l.id, createdBy: l.createdBy, createdAt: l.createdAt }));
}

/** Backlinks: what links to this object. */
export function linksTo(businessId: string, ref: ObjectRef): LinkedRef[] {
  return db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.businessId, businessId), toSide(ref)))
    .all()
    .map((l) => ({ type: l.fromType, id: l.fromId, direction: "in" as const, linkId: l.id, createdBy: l.createdBy, createdAt: l.createdAt }));
}

/** Both directions, newest first. An object linked both ways appears twice (once per direction). */
export function linksFor(businessId: string, ref: ObjectRef): LinkedRef[] {
  return [...linksFrom(businessId, ref), ...linksTo(businessId, ref)].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Drop every link to or from an object (when it's purged for good). */
export function removeLinksFor(businessId: string, ref: ObjectRef) {
  db.delete(schema.links)
    .where(and(eq(schema.links.businessId, businessId), or(fromSide(ref), toSide(ref))))
    .run();
}

/** A linked object for display: its title, where it opens, and whether it's in Trash. Null when it's gone. */
export type RefInfo = ObjectRef & { title: string; href: string; deleted: boolean };

export function describeRef(businessId: string, ref: ObjectRef): RefInfo | null {
  const base = `/b/${businessId}`;
  switch (ref.type) {
    case "doc": {
      const t = schema.contextPages;
      const p = db.select({ title: t.title, deletedAt: t.deletedAt }).from(t).where(and(eq(t.id, ref.id), eq(t.businessId, businessId))).get();
      return p ? { ...ref, title: p.title, href: `${base}/context?page=${ref.id}`, deleted: !!p.deletedAt } : null;
    }
    case "deliverable": {
      const t = schema.deliverables;
      const d = db.select({ title: t.title, deletedAt: t.deletedAt }).from(t).where(and(eq(t.id, ref.id), eq(t.businessId, businessId))).get();
      return d ? { ...ref, title: d.title, href: `${base}/docs?doc=${ref.id}`, deleted: !!d.deletedAt } : null;
    }
    case "contact": {
      const t = schema.contacts;
      const c = db.select({ name: t.name, deletedAt: t.deletedAt }).from(t).where(and(eq(t.id, ref.id), eq(t.businessId, businessId))).get();
      return c ? { ...ref, title: c.name, href: `${base}/contacts?c=${ref.id}`, deleted: !!c.deletedAt } : null;
    }
    case "task": {
      const t = schema.tasks;
      const k = db.select({ title: t.title, teammateId: t.teammateId }).from(t).where(and(eq(t.id, ref.id), eq(t.businessId, businessId))).get();
      return k ? { ...ref, title: k.title, href: `${base}/teammates/${k.teammateId}`, deleted: false } : null;
    }
    case "asset": {
      // A library file may have no assets row (not organized yet): the path is enough.
      const t = schema.assets;
      const a = db.select({ title: t.title, deletedAt: t.deletedAt }).from(t).where(and(eq(t.path, ref.id), eq(t.businessId, businessId))).get();
      return { ...ref, title: a?.title || path.posix.basename(ref.id), href: `${base}/library?f=${encodeURIComponent(ref.id)}`, deleted: !!a?.deletedAt };
    }
  }
}
