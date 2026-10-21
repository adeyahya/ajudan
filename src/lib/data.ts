import { and, asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";

/**
 * Read helpers for Server Components. better-sqlite3 is synchronous, so each helper
 * awaits connection() to keep the query out of prerendering (Next.js Cache Components).
 * Call them inside a <Suspense> boundary.
 */

export async function getBusiness(id: string) {
  await connection();
  return db.select().from(schema.businesses).where(eq(schema.businesses.id, id)).get();
}

export async function listBusinesses() {
  await connection();
  return db.select().from(schema.businesses).orderBy(asc(schema.businesses.createdAt)).all();
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
