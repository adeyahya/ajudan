import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";

/** Read helpers for the onboarding / team / profile pages. Call inside <Suspense>. */

export async function listOnboardingMessages(businessId: string) {
  await connection();
  return db
    .select()
    .from(schema.onboardingMessages)
    .where(eq(schema.onboardingMessages.businessId, businessId))
    .orderBy(asc(schema.onboardingMessages.createdAt))
    .all();
}

/** Most recent activity event for the business among the given types. */
export async function lastEventOf(businessId: string, types: string[]) {
  await connection();
  return db
    .select()
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.businessId, businessId), inArray(schema.activityEvents.type, types)))
    .orderBy(desc(schema.activityEvents.id))
    .limit(1)
    .get();
}

/** Interviewer tool steps, oldest first (used to show each reply's trace). */
export async function listOnboardingSteps(businessId: string) {
  await connection();
  return db
    .select({ id: schema.activityEvents.id, message: schema.activityEvents.message, createdAt: schema.activityEvents.createdAt })
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.businessId, businessId), eq(schema.activityEvents.type, "onboarding_tool")))
    .orderBy(asc(schema.activityEvents.id))
    .all();
}
