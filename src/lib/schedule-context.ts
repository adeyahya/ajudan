import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Teammate } from "@/db/schema";
import { nextRunOf } from "@/lib/onboarding/schedule";

/**
 * A scheduled run doesn't start blank: its instructions are the schedule prompt
 * followed by what happened since the previous scheduled run (its result, the work
 * saved since and what the owner did with it, what's still waiting). Used by the
 * scheduler (worker/scheduler.ts) and by "Run scheduled work now".
 */

const RESULT_CHARS = 600;
const MAX_ITEMS = 10;

export type ScheduleContext = {
  previous: { title: string; status: string; finishedAt: Date | null; result: string | null } | null;
  /** Work this teammate saved since the previous scheduled run; status is the owner's verdict. */
  deliverables: { title: string; kind: string; status: string }[];
  /** Approval requests of this teammate the owner hasn't decided yet. */
  approvals: { summary: string }[];
  /** Tasks of this teammate waiting on the owner or on a person. */
  waiting: { title: string; status: string }[];
};

const DELIVERABLE_STATUS: Record<string, string> = {
  draft: "draft, not reviewed yet",
  ready_to_post: "ready for the owner to post",
  approved: "approved by the owner",
  published: "posted by the owner",
  rejected: "rejected by the owner",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** The task text: the schedule prompt first (it becomes the title), then the context. */
export function formatScheduledInstructions(schedulePrompt: string, ctx: ScheduleContext) {
  const lines: string[] = [];
  if (ctx.previous) {
    const when = ctx.previous.finishedAt ? ` (${ctx.previous.finishedAt.toISOString().slice(0, 10)})` : "";
    lines.push(`### Previous scheduled run${when}: ${ctx.previous.status}`);
    const result = ctx.previous.result?.trim();
    lines.push(result ? clip(result.replace(/\s*\n\s*\n+/g, "\n"), RESULT_CHARS) : "(no summary was written)");
  } else {
    lines.push("### Previous scheduled run\nThis is the first scheduled run.");
  }
  if (ctx.deliverables.length) {
    lines.push("### Work you saved since then (and what the owner did with it)");
    for (const d of ctx.deliverables.slice(0, MAX_ITEMS)) lines.push(`- ${d.title} (${d.kind}): ${DELIVERABLE_STATUS[d.status] ?? d.status}`);
    if (ctx.deliverables.length > MAX_ITEMS) lines.push(`- …and ${ctx.deliverables.length - MAX_ITEMS} more on the Work page`);
  }
  if (ctx.approvals.length || ctx.waiting.length) {
    lines.push("### Still open");
    for (const a of ctx.approvals.slice(0, MAX_ITEMS)) lines.push(`- Waiting for the owner's approval: ${clip(a.summary, 160)}`);
    for (const w of ctx.waiting.slice(0, MAX_ITEMS))
      lines.push(`- "${w.title}" is ${w.status === "waiting_human" ? "waiting for a person's reply" : "waiting for the owner"}`);
    lines.push("Don't redo or re-ask these; build on them or carry on with the rest.");
  }
  return `${schedulePrompt.trim()}\n\n## Since your last scheduled run\n${lines.join("\n")}`;
}

/** Gather the context from the database. */
export function scheduleContext(teammate: Pick<Teammate, "id" | "businessId">): ScheduleContext {
  const prev = db
    .select({
      title: schema.tasks.title,
      status: schema.tasks.status,
      result: schema.tasks.result,
      createdAt: schema.tasks.createdAt,
      finishedAt: schema.tasks.finishedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.teammateId, teammate.id),
        eq(schema.tasks.createdBy, "schedule"),
        inArray(schema.tasks.status, ["done", "failed", "cancelled"]),
      ),
    )
    .orderBy(desc(schema.tasks.createdAt))
    .get();
  const since = prev?.createdAt;
  const deliverables = db
    .select({ title: schema.deliverables.title, kind: schema.deliverables.kind, status: schema.deliverables.status })
    .from(schema.deliverables)
    .where(and(eq(schema.deliverables.teammateId, teammate.id), isNull(schema.deliverables.deletedAt), since ? gte(schema.deliverables.createdAt, since) : undefined))
    .orderBy(desc(schema.deliverables.createdAt))
    .limit(MAX_ITEMS + 1)
    .all();
  const approvals = db
    .select({ summary: schema.approvals.summary })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.teammateId, teammate.id), eq(schema.approvals.status, "pending")))
    .orderBy(desc(schema.approvals.createdAt))
    .limit(MAX_ITEMS + 1)
    .all();
  const waiting = db
    .select({ title: schema.tasks.title, status: schema.tasks.status })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.teammateId, teammate.id), inArray(schema.tasks.status, ["waiting_approval", "waiting_human"])))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(MAX_ITEMS + 1)
    .all();
  return {
    previous: prev ? { title: prev.title, status: prev.status, finishedAt: prev.finishedAt, result: prev.result } : null,
    deliverables,
    approvals,
    waiting,
  };
}

/** Full instructions for the teammate's next scheduled task. */
export function scheduledInstructions(teammate: Pick<Teammate, "id" | "businessId" | "schedulePrompt">) {
  return formatScheduledInstructions(teammate.schedulePrompt ?? "", scheduleContext(teammate));
}

export type ScheduleStatus = { nextRun: Date | null; lastRun: Date | null; lastSkipped: Date | null };

/** "Next run · last run · last skipped" for each scheduled teammate of the business. */
export function scheduleStatuses(teammates: Pick<Teammate, "id" | "schedule" | "schedulePrompt" | "status">[], now = new Date()) {
  const out = new Map<string, ScheduleStatus>();
  const scheduled = teammates.filter((t) => t.schedule?.trim() && t.schedulePrompt?.trim());
  if (!scheduled.length) return out;
  const ids = scheduled.map((t) => t.id);
  const lastRuns = new Map<string, Date>();
  for (const r of db
    .select({ teammateId: schema.tasks.teammateId, createdAt: schema.tasks.createdAt })
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.teammateId, ids), eq(schema.tasks.createdBy, "schedule")))
    .orderBy(desc(schema.tasks.createdAt))
    .all()) {
    if (!lastRuns.has(r.teammateId)) lastRuns.set(r.teammateId, r.createdAt);
  }
  const lastSkips = new Map<string, Date>();
  for (const e of db
    .select({ teammateId: schema.activityEvents.teammateId, createdAt: schema.activityEvents.createdAt })
    .from(schema.activityEvents)
    .where(and(inArray(schema.activityEvents.teammateId, ids), eq(schema.activityEvents.type, "schedule_skipped")))
    .orderBy(desc(schema.activityEvents.id))
    .all()) {
    if (e.teammateId && !lastSkips.has(e.teammateId)) lastSkips.set(e.teammateId, e.createdAt);
  }
  for (const t of scheduled) {
    out.set(t.id, {
      nextRun: t.status === "active" ? nextRunOf(t.schedule, now) : null,
      lastRun: lastRuns.get(t.id) ?? null,
      lastSkipped: lastSkips.get(t.id) ?? null,
    });
  }
  return out;
}
