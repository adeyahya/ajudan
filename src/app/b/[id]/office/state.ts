import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { ActivityEvent, TeammateState } from "@/db/schema";
import { MANAGER_ROLE } from "@/lib/roles";

/** What the office needs to render. Shared by the page (initial props) and GET /api/b/[id]/state. */
export type OfficeTeammate = {
  id: string;
  name: string;
  title: string;
  color: string;
  state: TeammateState;
  currentActivity: string | null;
  deskIndex: number;
  roleKey: string;
};

export type OfficeState = {
  /** AI teammates only: people on WhatsApp have no desk. */
  teammates: OfficeTeammate[];
  /** The manager's id; "Give a task" goes through it. */
  managerId: string | null;
  pendingApprovals: number;
  runningTasks: number;
  queuedTasks: number;
  /** Saved deliverables, shown as binders on the office's Work shelf. */
  deliverableCount: number;
};

/** Synchronous SQLite read. Server Components must `await connection()` before calling it. */
export function queryOfficeState(businessId: string): OfficeState {
  const teammates = db
    .select({
      id: schema.teammates.id,
      name: schema.teammates.name,
      title: schema.teammates.title,
      color: schema.teammates.color,
      state: schema.teammates.state,
      currentActivity: schema.teammates.currentActivity,
      deskIndex: schema.teammates.deskIndex,
      roleKey: schema.teammates.roleKey,
    })
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active"), eq(schema.teammates.kind, "ai")))
    .orderBy(asc(schema.teammates.deskIndex))
    .all();
  const managerId = teammates.find((t) => t.roleKey === MANAGER_ROLE.key)?.id ?? null;

  const pendingApprovals = db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending")))
    .all().length;

  const taskRows = db
    .select({ status: schema.tasks.status })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.businessId, businessId), inArray(schema.tasks.status, ["running", "queued"])))
    .all();

  const deliverableCount = db
    .select({ id: schema.deliverables.id })
    .from(schema.deliverables)
    .where(eq(schema.deliverables.businessId, businessId))
    .all().length;

  return {
    teammates,
    managerId,
    deliverableCount,
    pendingApprovals,
    runningTasks: taskRows.filter((t) => t.status === "running").length,
    queuedTasks: taskRows.filter((t) => t.status === "queued").length,
  };
}

/** Most recent events, oldest first. */
export function queryRecentEvents(businessId: string, limit = 30): ActivityEvent[] {
  return db
    .select()
    .from(schema.activityEvents)
    .where(eq(schema.activityEvents.businessId, businessId))
    .orderBy(desc(schema.activityEvents.id))
    .limit(limit)
    .all()
    .reverse();
}

/** Initial office data for the Server Component, plus the server time for relative timestamps. */
export async function loadOffice(businessId: string) {
  await connection();
  return { state: queryOfficeState(businessId), events: queryRecentEvents(businessId, 30), now: Date.now() };
}
