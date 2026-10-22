import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// A fresh business folder (see jobs.test.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-schedule-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { scheduleContext, scheduleStatuses } = await import("@/lib/schedule-context");
const { fire } = await import("../worker/scheduler");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
let mateId: string;

beforeEach(() => {
  db.delete(schema.jobs).run();
  db.delete(schema.businesses).run(); // cascades to teammates, tasks, approvals, deliverables
  businessId = db.insert(schema.businesses).values({ name: "Test", status: "active" }).returning().get().id;
  mateId = db
    .insert(schema.teammates)
    .values({
      businessId,
      name: "Raka",
      roleKey: "copywriter",
      title: "Copywriter",
      status: "active",
      autonomy: "ask",
      schedule: "0 9 * * 1",
      schedulePrompt: "Plan this week's posts",
    })
    .returning()
    .get().id;
});

const at = (iso: string) => new Date(iso);
const task = (v: Partial<typeof schema.tasks.$inferInsert> = {}) =>
  db.insert(schema.tasks).values({ businessId, teammateId: mateId, title: "t", instructions: "t", ...v }).returning().get();
const deliverable = (v: Partial<typeof schema.deliverables.$inferInsert> = {}) =>
  db.insert(schema.deliverables).values({ businessId, teammateId: mateId, kind: "social_post", title: "Post", content: "x", ...v }).returning().get();
const skips = () =>
  db
    .select()
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.teammateId, mateId), eq(schema.activityEvents.type, "schedule_skipped")))
    .all();

describe("scheduleContext", () => {
  it("is empty before the first scheduled run", () => {
    const ctx = scheduleContext({ id: mateId, businessId });
    expect(ctx.previous).toBeNull();
    expect(ctx.deliverables).toEqual([]);
  });

  it("uses the latest finished scheduled run, the work saved since and what's still open", () => {
    task({ createdBy: "schedule", status: "done", title: "Old plan", result: "old", createdAt: at("2026-10-05T09:00:00Z") });
    task({ createdBy: "schedule", status: "done", title: "Last plan", result: "Wrote 3 posts", createdAt: at("2026-10-12T09:00:00Z"), finishedAt: at("2026-10-12T09:20:00Z") });
    task({ createdBy: "user", status: "done", title: "Owner ask", createdAt: at("2026-10-13T09:00:00Z") });
    deliverable({ title: "Before", createdAt: at("2026-10-06T10:00:00Z") });
    deliverable({ title: "Post A", status: "approved", createdAt: at("2026-10-12T09:10:00Z") });
    deliverable({ title: "Post B", status: "rejected", createdAt: at("2026-10-13T10:00:00Z") });
    const waiting = task({ status: "waiting_human", title: "Ask Budi for footage" });
    db.insert(schema.approvals)
      .values({ businessId, teammateId: mateId, taskId: waiting.id, toolName: "t", input: {}, summary: "Send to supplier group" })
      .run();

    const ctx = scheduleContext({ id: mateId, businessId });
    expect(ctx.previous).toMatchObject({ title: "Last plan", status: "done", result: "Wrote 3 posts" });
    expect(ctx.deliverables.map((d) => d.title).sort()).toEqual(["Post A", "Post B"]);
    expect(ctx.approvals).toEqual([{ summary: "Send to supplier group" }]);
    expect(ctx.waiting).toEqual([{ title: "Ask Budi for footage", status: "waiting_human" }]);
  });
});

describe("fire", () => {
  it("creates a scheduled task whose instructions carry the previous run", () => {
    task({ createdBy: "schedule", status: "done", title: "Last plan", result: "Wrote 3 posts", createdAt: at("2026-10-12T09:00:00Z") });
    const t = fire(mateId)!;
    expect(t.createdBy).toBe("schedule");
    expect(t.title).toBe("Plan this week's posts");
    expect(t.instructions).toContain("## Since your last scheduled run");
    expect(t.instructions).toContain("Wrote 3 posts");
    expect(db.select().from(schema.jobs).all()).toHaveLength(1);
    expect(skips()).toHaveLength(0);
  });

  it("skips while the previous scheduled run is pending, logging one event per slot", () => {
    const pending = task({ createdBy: "schedule", status: "waiting_approval", title: "Last plan" });
    expect(fire(mateId)).toBeUndefined();
    expect(fire(mateId)).toBeUndefined();
    const events = skips();
    expect(events).toHaveLength(2);
    expect(events[0].taskId).toBe(pending.id);
    expect(events[0].message).toContain("waiting for your approval");
    expect(db.select().from(schema.jobs).all()).toHaveLength(0);

    const status = scheduleStatuses([{ id: mateId, schedule: "0 9 * * 1", schedulePrompt: "x", status: "active" }]).get(mateId)!;
    expect(status.lastSkipped).toBeInstanceOf(Date);
    expect(status.lastRun).toBeInstanceOf(Date);
    expect(status.nextRun!.getDay()).toBe(1);
  });

  it("does nothing for an archived teammate", () => {
    db.update(schema.teammates).set({ status: "archived" }).where(eq(schema.teammates.id, mateId)).run();
    expect(fire(mateId)).toBeUndefined();
    expect(skips()).toHaveLength(0);
  });
});
