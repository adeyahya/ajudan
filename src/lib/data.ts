import { and, asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { currentDataDir } from "@/lib/paths";

/**
 * Read helpers for Server Components. better-sqlite3 is synchronous, so each helper
 * awaits connection() to keep the query out of prerendering (Next.js Cache Components).
 * Call them inside a <Suspense> boundary.
 */

/** The business, if it's in the open folder (undefined when another folder is open). */
export async function getBusiness(id: string) {
  await connection();
  if (!currentDataDir()) return undefined;
  return db.select().from(schema.businesses).where(eq(schema.businesses.id, id)).get();
}

export async function listTeammates(businessId: string, status: "proposed" | "active" = "active") {
  await connection();
  return db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, status)))
    .orderBy(asc(schema.teammates.deskIndex))
    .all();
}

export async function pendingApprovalCount(businessId: string) {
  await connection();
  return db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending")))
    .all().length;
}
