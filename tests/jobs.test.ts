import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// A fresh business folder: `db` (src/db/index.ts) opens <AJUDAN_DATA_DIR>/ajudan.db on first
// use and applies the drizzle/ migrations to it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-jobs-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { claimJob, enqueueJob, finishJob, laneOf, requeueJob, requeueStaleJobs } = await import("@/lib/jobs");
const { MANAGER_ROLE } = await import("@/lib/roles");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
let managerTaskId: string;
let teamTaskId: string;

beforeEach(() => {
  db.delete(schema.jobs).run();
  db.delete(schema.businesses).run(); // cascades to teammates and tasks
  businessId = db.insert(schema.businesses).values({ name: "Test" }).returning().get().id;
  const manager = db.insert(schema.teammates).values({ businessId, name: "Mgr", roleKey: MANAGER_ROLE.key, title: "Manager" }).returning().get();
  const writer = db.insert(schema.teammates).values({ businessId, name: "Raka", roleKey: "copywriter", title: "Copywriter" }).returning().get();
  managerTaskId = db.insert(schema.tasks).values({ businessId, teammateId: manager.id, title: "m", instructions: "m" }).returning().get().id;
  teamTaskId = db.insert(schema.tasks).values({ businessId, teammateId: writer.id, title: "t", instructions: "t" }).returning().get().id;
});

const jobRow = (id: number) => db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get()!;

describe("migrations on a fresh folder", () => {
  it("created the database with every migration recorded", () => {
    expect(fs.existsSync(path.join(dir, "ajudan.db"))).toBe(true);
    const journal = JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: unknown[] };
    const applied = db.all<{ n: number }>("select count(*) as n from __drizzle_migrations");
    expect(applied[0].n).toBe(journal.entries.length);
    // A fresh folder takes no backup.
    expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
  });
});

describe("enqueueJob", () => {
  it("inserts a queued job with its payload", () => {
    const id = enqueueJob("run_task", { taskId: teamTaskId });
    expect(jobRow(id)).toMatchObject({ kind: "run_task", payload: { taskId: teamTaskId }, status: "queued", attempts: 0, startedAt: null });
  });
});

describe("laneOf", () => {
  it("puts owner-facing kinds in the owner lane", () => {
    expect(laneOf({ kind: "onboarding_turn", payload: { businessId } })).toBe("owner");
    expect(laneOf({ kind: "onboarding_finalize", payload: { businessId } })).toBe("owner");
    expect(laneOf({ kind: "design_team", payload: { businessId } })).toBe("owner");
  });

  it("puts the manager's tasks in the owner lane and other teammates' in the team lane", () => {
    expect(laneOf({ kind: "run_task", payload: { taskId: managerTaskId } })).toBe("owner");
    expect(laneOf({ kind: "run_task", payload: { taskId: teamTaskId } })).toBe("team");
  });

  it("treats a run_task for an unknown task as team work", () => {
    expect(laneOf({ kind: "run_task", payload: { taskId: "missing" } })).toBe("team");
    expect(laneOf({ kind: "run_task", payload: {} })).toBe("team");
  });
});

describe("claimJob", () => {
  it("returns undefined when nothing is queued", () => {
    expect(claimJob()).toBeUndefined();
    expect(claimJob("owner")).toBeUndefined();
  });

  it("claims the oldest queued job and marks it running", () => {
    const first = enqueueJob("run_task", { taskId: teamTaskId });
    const second = enqueueJob("run_task", { taskId: teamTaskId });
    const job = claimJob();
    expect(job?.id).toBe(first);
    expect(jobRow(first)).toMatchObject({ status: "running", attempts: 1 });
    expect(jobRow(first).startedAt).toBeInstanceOf(Date);
    expect(jobRow(second).status).toBe("queued");
  });

  it("returns the row as it was before the claim (current behaviour)", () => {
    const id = enqueueJob("run_task", { taskId: teamTaskId });
    const job = claimJob();
    expect(job?.id).toBe(id);
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(0);
  });

  it("never hands the same job out twice", () => {
    enqueueJob("design_team", { businessId });
    expect(claimJob()).toBeDefined();
    expect(claimJob()).toBeUndefined();
  });

  it("skips done and failed jobs", () => {
    const a = enqueueJob("design_team", { businessId });
    finishJob(a);
    const b = enqueueJob("design_team", { businessId });
    finishJob(b, new Error("boom"));
    expect(jobRow(a).status).toBe("done");
    expect(jobRow(b)).toMatchObject({ status: "failed" });
    expect(jobRow(b).error).toContain("boom");
    expect(claimJob()).toBeUndefined();
  });

  it("claims per lane, leaving the other lane's jobs queued", () => {
    const team = enqueueJob("run_task", { taskId: teamTaskId });
    const owner = enqueueJob("run_task", { taskId: managerTaskId });
    const onboarding = enqueueJob("onboarding_turn", { businessId });

    expect(claimJob("owner")?.id).toBe(owner);
    expect(jobRow(team).status).toBe("queued");
    expect(claimJob("owner")?.id).toBe(onboarding);
    expect(claimJob("owner")).toBeUndefined();
    expect(claimJob("team")?.id).toBe(team);
    expect(claimJob("team")).toBeUndefined();
  });
});

describe("requeue", () => {
  it("requeueStaleJobs puts running jobs back and leaves the others", () => {
    const running = enqueueJob("design_team", { businessId });
    claimJob();
    const done = enqueueJob("design_team", { businessId });
    claimJob();
    finishJob(done);
    const queued = enqueueJob("design_team", { businessId });

    requeueStaleJobs();
    expect(jobRow(running).status).toBe("queued");
    expect(jobRow(done).status).toBe("done");
    expect(jobRow(queued).status).toBe("queued");
    // The attempt stays counted and startedAt is kept (only requeueJob clears it).
    expect(jobRow(running).attempts).toBe(1);
    expect(jobRow(running).startedAt).toBeInstanceOf(Date);
    expect(claimJob()?.id).toBe(running);
    expect(jobRow(running).attempts).toBe(2);
  });

  it("requeueJob resets one job's status and start time, and a pause doesn't count as a try", () => {
    const id = enqueueJob("design_team", { businessId });
    claimJob();
    requeueJob(id);
    expect(jobRow(id)).toMatchObject({ status: "queued", startedAt: null, attempts: 0 });
  });
});
