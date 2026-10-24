import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contact } from "@/db/schema";

/**
 * Contacts whose follow-up is due by `until` (default now), soonest first, leaving Trash
 * out. Home's stand-in for `dueFollowUps` in src/lib/contacts.ts (same signature): switch
 * Home to that one when it lands and delete this file.
 */
export function dueFollowUps(businessId: string, until: Date = new Date()): Contact[] {
  const c = schema.contacts;
  return db
    .select()
    .from(c)
    .where(and(eq(c.businessId, businessId), isNull(c.deletedAt), lte(c.followUpAt, until)))
    .orderBy(asc(c.followUpAt))
    .all();
}
