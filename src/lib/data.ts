import { and, asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { overBudget, spentThisWeek, spentToday } from "@/lib/budget";
import { currentDataDir } from "@/lib/paths";
import { computeProgress } from "@/lib/progress";

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

/** Today's and this week's team spend, against the daily cap (src/lib/budget.ts). */
export async function getSpend(businessId: string) {
  await connection();
  const cap = db.select({ cap: schema.businesses.dailyBudgetUsd }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.cap ?? 0;
  const today = spentToday(businessId);
  return { today, week: spentThisWeek(businessId), cap, over: overBudget(today, cap) };
}

export async function pendingApprovalCount(businessId: string) {
  await connection();
  return db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending")))
    .all().length;
}

/** XP, levels, trust and the clean-queue streak for the chat home (src/lib/progress.ts). */
export async function getProgress(businessId: string) {
  await connection();
  const tasks = db
    .select({
      teammateId: schema.tasks.teammateId,
      status: schema.tasks.status,
      createdBy: schema.tasks.createdBy,
      createdAt: schema.tasks.createdAt,
      finishedAt: schema.tasks.finishedAt,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.businessId, businessId), eq(schema.tasks.status, "done")))
    .all();
  const deliverables = db
    .select({ teammateId: schema.deliverables.teammateId, status: schema.deliverables.status, versions: schema.deliverables.versions, createdAt: schema.deliverables.createdAt })
    .from(schema.deliverables)
    .where(eq(schema.deliverables.businessId, businessId))
    .all()
    .map(({ versions, ...d }) => ({ ...d, revisions: versions.length }));
  const approvals = db
    .select({ teammateId: schema.approvals.teammateId, status: schema.approvals.status, createdAt: schema.approvals.createdAt, decidedAt: schema.approvals.decidedAt })
    .from(schema.approvals)
    .where(eq(schema.approvals.businessId, businessId))
    .all();
  const teammateIds = db.select({ id: schema.teammates.id }).from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all().map((t) => t.id);
  return computeProgress({ tasks, deliverables, approvals, teammateIds }, new Date());
}
