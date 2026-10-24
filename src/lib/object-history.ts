import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { HistoryAction, ObjectType } from "@/db/schema";

/**
 * A snapshot of a workspace object per change, with who made it ("owner", "system" or
 * "teammate:<id>"). Trash records "delete"/"restore" (src/lib/trash.ts); editors and
 * teammate tools record "create"/"update". Restoring an older snapshot is up to the
 * History UI: put the snapshot's fields back and record a new "update".
 */

export type { HistoryAction, ObjectType };
export type HistoryEntry = typeof schema.objectHistory.$inferSelect;

/** JSON-safe copy of a row (Dates become ISO strings, as JSON.stringify would write them). */
export function toSnapshot(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

export function recordHistory(v: { businessId: string; type: ObjectType; id: string; snapshot: object; action: HistoryAction; by: string }) {
  return db
    .insert(schema.objectHistory)
    .values({ businessId: v.businessId, objectType: v.type, objectId: v.id, snapshot: toSnapshot(v.snapshot), action: v.action, by: v.by })
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
