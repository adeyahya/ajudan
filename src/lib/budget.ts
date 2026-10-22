import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * The team's spending, per business: the sum of tasks.costUsd (written when a task
 * finishes, so a run in progress doesn't count yet). The daily cap lives on
 * businesses.dailyBudgetUsd; the worker stops claiming that business's task jobs
 * once today's spend reaches it (src/lib/jobs.ts) and carries on the next day or
 * when the owner raises the cap.
 */

export const DEFAULT_DAILY_BUDGET_USD = 20;
export const MAX_DAILY_BUDGET_USD = 1000;

/** Midnight (server-local) of the given moment. */
export function startOfDay(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Monday 00:00 (server-local) of the given moment's week. */
export function startOfWeek(now = new Date()) {
  const d = startOfDay(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** True when today's spend has reached the cap (a cap of 0 or less means no limit). */
export function overBudget(spentTodayUsd: number, dailyBudgetUsd: number) {
  return dailyBudgetUsd > 0 && spentTodayUsd >= dailyBudgetUsd;
}

/** A cap typed by the owner: a positive number of dollars, or null when it's not one. */
export function parseBudget(raw: unknown) {
  const n = Number(String(raw ?? "").trim().replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n * 100) / 100, MAX_DAILY_BUDGET_USD);
}

/** Sum of the business's task costs finished since `since`. */
export function spentSince(businessId: string, since: Date) {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${schema.tasks.costUsd}), 0)` })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.businessId, businessId), gte(schema.tasks.finishedAt, since)))
    .get();
  return row?.total ?? 0;
}

/** The business's task costs finished since `since`, per teammate (highest first). */
export function spentByTeammate(businessId: string, since: Date) {
  return db
    .select({
      teammateId: schema.tasks.teammateId,
      name: schema.teammates.name,
      color: schema.teammates.color,
      total: sql<number>`coalesce(sum(${schema.tasks.costUsd}), 0)`,
      tasks: sql<number>`count(*)`,
    })
    .from(schema.tasks)
    .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
    .where(and(eq(schema.tasks.businessId, businessId), gte(schema.tasks.finishedAt, since)))
    .groupBy(schema.tasks.teammateId, schema.teammates.name, schema.teammates.color)
    .orderBy(sql`sum(${schema.tasks.costUsd}) desc`)
    .all();
}

export function spentToday(businessId: string, now = new Date()) {
  return spentSince(businessId, startOfDay(now));
}

export function spentThisWeek(businessId: string, now = new Date()) {
  return spentSince(businessId, startOfWeek(now));
}

export function formatUsd(n: number) {
  return `$${n.toFixed(2)}`;
}
