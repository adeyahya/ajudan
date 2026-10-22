import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-reporting-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { canReview, onTaskFinished, REPORT, RESULTS, REVISION } = await import("@/lib/manager");
const { delegatedInstructions, ownerRequest } = await import("@/lib/tasks");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
const ids = { manager: "", ana: "", budi: "", human: "" };

const mate = (name: string, roleKey: string, kind: "ai" | "human" = "ai") =>
  db.insert(schema.teammates).values({ businessId, name, roleKey, title: name, status: "active", kind }).returning().get().id;
const task = (teammateId: string, parentTaskId: string | null, createdBy: string, instructions = "Do it") =>
  db.insert(schema.tasks).values({ businessId, teammateId, title: instructions.slice(0, 40), instructions, createdBy, parentTaskId, sessionId: `s-${instructions.length}` }).returning().get();
/** Finishes a task a moment after everything before it, as in a real run. */
const finish = async (id: string) => {
  await new Promise((r) => setTimeout(r, 3));
  db.update(schema.tasks).set({ status: "done", result: `result of ${id}`, finishedAt: new Date() }).where(eq(schema.tasks.id, id)).run();
  onTaskFinished(id);
};
const followUps = (createdBy: string) => db.select().from(schema.tasks).where(and(eq(schema.tasks.businessId, businessId), eq(schema.tasks.createdBy, createdBy))).all();

beforeEach(() => {
  db.delete(schema.businesses).run();
  businessId = db.insert(schema.businesses).values({ name: "Test" }).returning().get().id;
  ids.manager = mate("Avery", "manager");
  ids.ana = mate("Ana", "content_marketer");
  ids.budi = mate("Budi", "social_media_manager");
  ids.human = mate("Rina", "human", "human");
});

describe("delegation reports back", () => {
  it("a sub-delegation goes back to the teammate who handed it on, then the manager reports once", async () => {
    const request = task(ids.manager, null, "user", "Make a launch campaign for the new tote bag");
    await finish(request.id);
    const t1 = task(ids.ana, request.id, `teammate:${ids.manager}`, "Write the launch post");
    const t2 = task(ids.budi, t1.id, `teammate:${ids.ana}`, "Make the Instagram version");
    task(ids.human, t2.id, `teammate:${ids.budi}`, "Film the bag"); // open, but a person's request doesn't block
    db.insert(schema.deliverables).values({ businessId, teammateId: ids.budi, taskId: t2.id, kind: "social_post", title: "Tote IG post", content: "Meet the tote" }).run();

    await finish(t1.id);
    expect(followUps(REPORT)).toHaveLength(0); // Budi is still working

    await finish(t2.id);
    const [results] = followUps(RESULTS);
    expect(results).toMatchObject({ teammateId: ids.ana, parentTaskId: t1.id, sessionId: t1.sessionId });
    expect(results.instructions).toContain("Meet the tote");
    expect(followUps(REPORT)).toHaveLength(0); // waits for Ana to fold it in

    await finish(results.id);
    const [report] = followUps(REPORT);
    expect(report).toMatchObject({ teammateId: ids.manager, parentTaskId: request.id });
    expect(report.instructions).toContain("Make a launch campaign");
    expect(report.instructions).toContain("Tote IG post");
    expect(report.instructions).toContain("request_revision");
    expect(canReview(report)).toBe(true);
    expect(followUps(RESULTS)).toHaveLength(1);
  });

  it("allows one revision round: the report after a revision can't send work back", async () => {
    const request = task(ids.manager, null, "user", "Write a post");
    const t1 = task(ids.ana, request.id, `teammate:${ids.manager}`);
    await finish(t1.id);
    const [first] = followUps(REPORT);
    expect(canReview(first)).toBe(true);
    await finish(first.id);

    const revision = task(ids.ana, request.id, REVISION, "Fix the price");
    await finish(revision.id);
    const reports = followUps(REPORT);
    expect(reports).toHaveLength(2);
    const second = reports.find((r) => r.id !== first.id)!;
    expect(canReview(second)).toBe(false);
    expect(second.instructions).not.toContain("request_revision(deliverable_id");
  });

  it("a teammate's own delegation (no manager above) reports back to that teammate only", async () => {
    const scheduled = task(ids.ana, null, "schedule", "Weekly content");
    const handed = task(ids.budi, scheduled.id, `teammate:${ids.ana}`);
    await finish(scheduled.id);
    await finish(handed.id);
    expect(followUps(RESULTS)).toHaveLength(1);
    expect(followUps(REPORT)).toHaveLength(0);
    await finish(followUps(RESULTS)[0].id);
    expect(followUps(RESULTS)).toHaveLength(1); // no second round from its own follow-up
  });
});

describe("the owner's words travel with the brief", () => {
  it("finds the owner's request at the top of the chain", () => {
    const request = task(ids.manager, null, "user", "Bikin promo 11.11 untuk tote bag");
    const t1 = task(ids.ana, request.id, `teammate:${ids.manager}`);
    expect(ownerRequest(t1.id)?.id).toBe(request.id);
    expect(ownerRequest(task(ids.ana, null, "schedule").id)).toBeUndefined();
    const text = delegatedInstructions("Write the caption", "Avery", request);
    expect(text.startsWith("## Your brief from Avery\nWrite the caption")).toBe(true);
    expect(text).toContain("> Bikin promo 11.11");
    expect(delegatedInstructions("Just this", "Avery", undefined)).toBe("Just this");
  });
});
