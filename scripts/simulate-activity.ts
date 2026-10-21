/**
 * Make the office come alive without Claude: loops over a business's teammates,
 * changing their state/currentActivity and writing activity_events.
 *   npx tsx scripts/simulate-activity.ts <businessId> [intervalMs=2500]
 * Ctrl+C resets everyone to idle.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Teammate, TeammateState } from "@/db/schema";
import { logEvent } from "@/lib/events";

const businessId = process.argv[2];
const intervalMs = Number(process.argv[3] ?? 2500);
if (!businessId) {
  console.error("Usage: npx tsx scripts/simulate-activity.ts <businessId> [intervalMs]");
  process.exit(1);
}

const team = db
  .select()
  .from(schema.teammates)
  .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
  .all();
if (!team.length) {
  console.error("No active teammates for that business.");
  process.exit(1);
}

const ACTIVITIES: Record<string, string[]> = {
  growth_lead: ["Planning this week's priorities", "Reviewing the team's drafts", "Writing the progress report"],
  content_marketer: ["Writing a blog post about paper gifts", "Editing the newsletter", "Polishing product descriptions"],
  social_media_manager: ["Drafting Instagram captions", "Planning the content calendar", "Researching trending hashtags"],
  market_researcher: ["Searching competitor prices", "Reading craft community forums", "Summarizing customer segments"],
};
const activityFor = (t: Teammate) => {
  const list = ACTIVITIES[t.roleKey] ?? ["Working on a task"];
  return list[Math.floor(Math.random() * list.length)];
};

const taskOf = new Map<string, string>();

function setState(t: Teammate, state: TeammateState, currentActivity: string | null) {
  db.update(schema.teammates).set({ state, currentActivity }).where(eq(schema.teammates.id, t.id)).run();
  t.state = state;
  t.currentActivity = currentActivity;
}

function finishTask(t: Teammate, status: "done" | "failed" | "cancelled") {
  const taskId = taskOf.get(t.id);
  if (!taskId) return;
  db.update(schema.tasks).set({ status, finishedAt: new Date() }).where(eq(schema.tasks.id, taskId)).run();
  taskOf.delete(t.id);
}

function resolveApprovals(t: Teammate) {
  db.update(schema.approvals)
    .set({ status: "approved", decidedAt: new Date(), note: "auto-approved by simulator" })
    .where(and(eq(schema.approvals.teammateId, t.id), eq(schema.approvals.status, "pending")))
    .run();
}

function startWork(t: Teammate) {
  const activity = activityFor(t);
  const task = db
    .insert(schema.tasks)
    .values({ businessId, teammateId: t.id, title: activity, instructions: activity, status: "running", startedAt: new Date() })
    .returning({ id: schema.tasks.id })
    .get();
  taskOf.set(t.id, task.id);
  setState(t, "working", activity);
  logEvent({ businessId, teammateId: t.id, taskId: task.id, type: "task_started", message: `${t.name} started: ${activity}` });
}

let tick = 0;
function step() {
  tick++;
  const t = team[Math.floor(Math.random() * team.length)];
  const roll = Math.random();

  // Every few ticks the lead delegates to someone, which animates in the office.
  const lead = team.find((m) => m.roleKey === "growth_lead") ?? team[0];
  if (tick % 5 === 0 && team.length > 1) {
    const others = team.filter((m) => m.id !== lead.id);
    const to = others[Math.floor(Math.random() * others.length)];
    logEvent({
      businessId,
      teammateId: lead.id,
      type: "delegated",
      message: `${lead.name} delegated a task to ${to.name}`,
      data: { from: lead.id, to: to.id },
    });
    if (to.state === "idle") startWork(to);
    return;
  }

  switch (t.state) {
    case "idle":
      startWork(t);
      break;
    case "working":
      if (roll < 0.3) {
        const next = activityFor(t);
        setState(t, "working", next);
        logEvent({ businessId, teammateId: t.id, type: "tool", message: `${t.name}: ${next}` });
      } else if (roll < 0.55) {
        db.insert(schema.approvals)
          .values({
            businessId,
            teammateId: t.id,
            taskId: taskOf.get(t.id) ?? null,
            toolName: "publish_post",
            input: { demo: true },
            summary: `${t.name} wants to publish a draft`,
          })
          .run();
        db.update(schema.tasks)
          .set({ status: "waiting_approval" })
          .where(eq(schema.tasks.id, taskOf.get(t.id) ?? ""))
          .run();
        setState(t, "waiting", "Waiting for your approval");
        logEvent({
          businessId,
          teammateId: t.id,
          type: "approval_requested",
          message: `${t.name} needs approval to publish a draft`,
        });
      } else if (roll < 0.62) {
        finishTask(t, "failed");
        setState(t, "error", "Something went wrong");
        logEvent({ businessId, teammateId: t.id, type: "task_failed", message: `${t.name} hit an error` });
      } else {
        const taskId = taskOf.get(t.id) ?? null;
        finishTask(t, "done");
        logEvent({
          businessId,
          teammateId: t.id,
          type: "task_done",
          message: `${t.name} finished: ${t.currentActivity ?? "a task"}`,
        });
        // Half the finished tasks produce a deliverable, which flies to the office's Work shelf.
        if (Math.random() < 0.5) {
          const title = t.currentActivity ?? "Demo deliverable";
          db.insert(schema.deliverables)
            .values({ businessId, teammateId: t.id, taskId, kind: "report", title, content: `Demo content: ${title}` })
            .run();
          logEvent({ businessId, teammateId: t.id, taskId, type: "deliverable_saved", message: `${t.name} saved: ${title}` });
        }
        setState(t, "idle", null);
      }
      break;
    case "waiting":
      if (roll < 0.5) {
        resolveApprovals(t);
        finishTask(t, "done");
        logEvent({ businessId, teammateId: t.id, type: "approval_decided", message: `Approved: ${t.name}'s draft` });
        setState(t, "idle", null);
      }
      break;
    case "error":
      setState(t, "idle", null);
      logEvent({ businessId, teammateId: t.id, type: "text", message: `${t.name} recovered and is ready again` });
      break;
  }
}

console.log(`Simulating ${team.length} teammates every ${intervalMs}ms. Ctrl+C to stop.`);
const timer = setInterval(step, intervalMs);

function shutdown() {
  clearInterval(timer);
  for (const t of team) {
    resolveApprovals(t);
    finishTask(t, "cancelled");
    setState(t, "idle", null);
  }
  console.log("Reset teammates to idle.");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
