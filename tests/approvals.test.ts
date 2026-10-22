import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// A fresh business folder (see jobs.test.ts).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-approvals-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { decide, findPendingByCode, sameAction, supersedeStaleApprovals } = await import("@/lib/approvals");
const { CAPABILITY } = await import("@/lib/capabilities");
const { cancelTask, createTask, retryTask } = await import("@/lib/tasks");
const { taskHistory } = await import("@/lib/history");
const { sessionPath } = await import("../worker/claude-sessions");
const { explainClosedCode } = await import("../worker/owner-approvals");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
let mateId: string;

beforeEach(() => {
  db.delete(schema.jobs).run();
  db.delete(schema.businesses).run(); // cascades to teammates, tasks and approvals
  businessId = db.insert(schema.businesses).values({ name: "Test", status: "active" }).returning().get().id;
  mateId = db.insert(schema.teammates).values({ businessId, name: "Raka", roleKey: "copywriter", title: "Copywriter", status: "active", autonomy: "ask" }).returning().get().id;
});

const task = (v: Partial<typeof schema.tasks.$inferInsert> = {}) =>
  db.insert(schema.tasks).values({ businessId, teammateId: mateId, title: "t", instructions: "t", ...v }).returning().get();
const approval = (taskId: string | null, v: Partial<typeof schema.approvals.$inferInsert> = {}) =>
  db
    .insert(schema.approvals)
    .values({ businessId, teammateId: mateId, taskId, toolName: "mcp__biz__http_request", input: { url: "https://x", method: "POST" }, summary: "Raka wants to POST to x", ...v })
    .returning()
    .get();
const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
const approvalRow = (id: string) => db.select().from(schema.approvals).where(eq(schema.approvals.id, id)).get()!;
const jobs = () => db.select().from(schema.jobs).all();

describe("sameAction", () => {
  const a = { toolName: "mcp__whatsapp__send_message", input: { chat: "123@s.whatsapp.net", message: "Halo ", recipientNames: ["Budi"] } };

  it("matches the same tool and arguments, ignoring key order, whitespace and recipientNames", () => {
    expect(sameAction(a, a.toolName, { message: "Halo", chat: "123@s.whatsapp.net" })).toBe(true);
    expect(sameAction(a, a.toolName, { message: "Halo", chat: "123@s.whatsapp.net", recipientNames: ["Other"] })).toBe(true);
  });

  it("rejects a different tool or different arguments", () => {
    expect(sameAction(a, "mcp__whatsapp__send_file", a.input)).toBe(false);
    expect(sameAction(a, a.toolName, { chat: "123@s.whatsapp.net", message: "Halo semua" })).toBe(false);
    expect(sameAction(a, a.toolName, { chat: "999@s.whatsapp.net", message: "Halo" })).toBe(false);
    expect(sameAction(a, a.toolName, { chat: "123@s.whatsapp.net", message: "Halo", file: "work/x.png" })).toBe(false);
  });

  it("compares nested values", () => {
    const b = { toolName: "t", input: { recipients: ["1@s.whatsapp.net", "2@s.whatsapp.net"], body: { a: 1, b: [true, null] } } };
    expect(sameAction(b, "t", { body: { b: [true, null], a: 1 }, recipients: ["1@s.whatsapp.net", "2@s.whatsapp.net"] })).toBe(true);
    expect(sameAction(b, "t", { body: { b: [null, true], a: 1 }, recipients: ["1@s.whatsapp.net", "2@s.whatsapp.net"] })).toBe(false);
    expect(sameAction(b, "t", { body: { a: 1, b: [true, null] }, recipients: ["2@s.whatsapp.net", "1@s.whatsapp.net"] })).toBe(false);
  });
});

describe("decide", () => {
  it("queues the waiting task's continuation with the approval id", async () => {
    const t = task({ status: "waiting_approval", sessionId: "sess-1" });
    db.update(schema.teammates).set({ state: "waiting" }).where(eq(schema.teammates.id, mateId)).run();
    const a = approval(t.id);
    const r = await decide({ businessId, approvalId: a.id, decision: "approved", note: " go ", via: "app" });
    expect(r.ok).toBe(true);
    expect(approvalRow(a.id)).toMatchObject({ status: "approved", note: "go" });
    expect(taskRow(t.id).status).toBe("queued");
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ kind: "run_task", payload: { taskId: t.id, approvalId: a.id }, status: "queued" });
    expect(db.select().from(schema.teammates).where(eq(schema.teammates.id, mateId)).get()?.state).toBe("idle");
  });

  it("rejecting also continues the task (the teammate hears the note)", async () => {
    const t = task({ status: "waiting_approval", sessionId: "sess-1" });
    const a = approval(t.id);
    await decide({ businessId, approvalId: a.id, decision: "rejected", note: "too long", via: "whatsapp" });
    expect(taskRow(t.id).status).toBe("queued");
    expect(jobs()[0].payload).toEqual({ taskId: t.id, approvalId: a.id });
  });

  it("records the decision without a continuation when the task isn't waiting", async () => {
    const t = task({ status: "cancelled" });
    const a = approval(t.id);
    const r = await decide({ businessId, approvalId: a.id, decision: "approved", via: "app" });
    expect(r.ok).toBe(true);
    expect(taskRow(t.id).status).toBe("cancelled");
    expect(jobs()).toHaveLength(0);
  });

  it("only the first decision wins", async () => {
    const t = task({ status: "waiting_approval" });
    const a = approval(t.id);
    expect((await decide({ businessId, approvalId: a.id, decision: "approved", via: "app" })).ok).toBe(true);
    expect((await decide({ businessId, approvalId: a.id, decision: "rejected", via: "whatsapp" })).ok).toBe(false);
    expect(jobs()).toHaveLength(1);
  });

  it("a granted capability creates a Go-ahead task that resumes the asking task's session", async () => {
    const t = task({ status: "done", sessionId: "sess-9", instructions: "fetch the report" });
    const a = approval(t.id, { toolName: CAPABILITY, input: { kind: "shell", why: "to run python" }, summary: "Raka wants a shell" });
    const r = await decide({ businessId, approvalId: a.id, decision: "approved", via: "app" });
    expect(r.ok).toBe(true);
    const ahead = db.select().from(schema.tasks).where(eq(schema.tasks.createdBy, "system:capability")).get();
    expect(ahead).toMatchObject({ teammateId: mateId, sessionId: "sess-9", status: "queued" });
    expect(ahead?.instructions).toContain("fetch the report");
    expect(jobs()[0].payload).toEqual({ taskId: ahead?.id });
  });
});

describe("supersedeStaleApprovals", () => {
  it("keeps requests of tasks waiting with a session, supersedes the rest, leaves capability requests", () => {
    const waiting = task({ status: "waiting_approval", sessionId: "sess-1" });
    const keep = approval(waiting.id);
    const noSession = task({ status: "waiting_approval" });
    const old = approval(noSession.id);
    const running = task({ status: "running", sessionId: "sess-2" });
    const mid = approval(running.id);
    const orphan = approval(null);
    const cap = approval(running.id, { toolName: CAPABILITY, input: { kind: "shell", why: "x" } });
    const decided = approval(running.id, { status: "approved" });

    expect(supersedeStaleApprovals()).toBe(3);
    expect(approvalRow(keep.id).status).toBe("pending");
    expect(approvalRow(old.id).status).toBe("superseded");
    expect(approvalRow(mid.id).status).toBe("superseded");
    expect(approvalRow(orphan.id).status).toBe("superseded");
    expect(approvalRow(cap.id).status).toBe("pending");
    expect(approvalRow(decided.id).status).toBe("approved");
    expect(approvalRow(old.id).decidedAt).toBeInstanceOf(Date);
    expect(supersedeStaleApprovals()).toBe(0);
  });

  it("a superseded code is explained to the owner, and no longer counts as open", () => {
    const t = task({ status: "running" });
    const a = approval(t.id);
    const code = a.id.slice(0, 4);
    expect(findPendingByCode(businessId, code)).toHaveLength(1);
    supersedeStaleApprovals();
    expect(findPendingByCode(businessId, code)).toHaveLength(0);
    const biz = { id: businessId, language: "en" as const };
    expect(explainClosedCode(biz, code)).toMatch(/was replaced/);
    expect(explainClosedCode({ ...biz, language: "id" }, code)).toMatch(/sudah diganti/);
    expect(explainClosedCode(biz, "zzzz")).toMatch(/No request/);
  });
});

describe("cancelTask", () => {
  it("cancels a queued task and its open requests, and frees a waiting teammate", () => {
    const t = task({ status: "waiting_approval" });
    db.update(schema.teammates).set({ state: "waiting", currentActivity: "Waiting" }).where(eq(schema.teammates.id, mateId)).run();
    const a = approval(t.id);
    const other = approval(task().id);
    expect(cancelTask(businessId, t.id)?.status).toBe("cancelled");
    expect(taskRow(t.id).finishedAt).toBeInstanceOf(Date);
    expect(approvalRow(a.id).status).toBe("cancelled");
    expect(approvalRow(other.id).status).toBe("pending");
    expect(db.select().from(schema.teammates).where(eq(schema.teammates.id, mateId)).get()).toMatchObject({ state: "idle", currentActivity: null });
    const biz = { id: businessId, language: "en" as const };
    expect(explainClosedCode(biz, a.id.slice(0, 4))).toMatch(/cancelled/);
  });

  it("leaves finished tasks and other businesses alone", () => {
    const done = task({ status: "done" });
    expect(cancelTask(businessId, done.id)).toBeUndefined();
    expect(taskRow(done.id).status).toBe("done");
    const t = task();
    expect(cancelTask("someone-else", t.id)).toBeUndefined();
    expect(taskRow(t.id).status).toBe("queued");
  });

  it("a cancelled task can be retried from the start", () => {
    const t = task({ status: "failed", result: "boom", sessionId: "sess-1", startedAt: new Date(), finishedAt: new Date() });
    expect(retryTask(businessId, t.id)?.status).toBe("queued");
    expect(taskRow(t.id)).toMatchObject({ status: "queued", result: null, sessionId: null, startedAt: null, finishedAt: null });
    expect(jobs()).toHaveLength(1);
    expect(retryTask(businessId, t.id)).toBeUndefined(); // already queued
  });
});

describe("taskHistory", () => {
  it("lists earlier tasks oldest first with results and saved work, bounded", () => {
    // Explicit times: tasks created in the same millisecond would tie.
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const first = createTask({ businessId, teammateId: mateId, instructions: "Write a caption", createdBy: "user" });
    db.update(schema.tasks).set({ status: "done", result: "Saved the caption.", createdAt: at(3) }).where(eq(schema.tasks.id, first.id)).run();
    db.insert(schema.deliverables).values({ businessId, teammateId: mateId, taskId: first.id, kind: "social_post", title: "Caption A", content: "…" }).run();
    const second = createTask({ businessId, teammateId: mateId, instructions: "x".repeat(900), createdBy: "schedule" });
    db.update(schema.tasks).set({ status: "failed", result: null, createdAt: at(2) }).where(eq(schema.tasks.id, second.id)).run();
    const now = createTask({ businessId, teammateId: mateId, instructions: "Now", createdBy: "user" });

    const h = taskHistory(mateId, now);
    expect(h.indexOf("Write a caption")).toBeLessThan(h.indexOf("Scheduled:"));
    expect(h).toContain('(saved: "Caption A" (id ');
    expect(h).toContain("You: (failed)");
    expect(h).not.toContain("x".repeat(501));
    expect(h).not.toContain("Now");
    expect(taskHistory(mateId, now, 1)).not.toContain("Write a caption");
  });

  it("is empty for a teammate's first task", () => {
    expect(taskHistory(mateId, task())).toBe("");
  });
});

describe("sessionPath", () => {
  it("maps the working folder the way Claude Code names project folders", () => {
    expect(sessionPath("/Users/me/Ajudan/Orucraft/teammates/raka", "abc", "/Users/me")).toBe(
      "/Users/me/.claude/projects/-Users-me-Ajudan-Orucraft-teammates-raka/abc.jsonl",
    );
    expect(sessionPath("/Users/me/.ajudan/x_y", "abc", "/Users/me")).toBe("/Users/me/.claude/projects/-Users-me--ajudan-x-y/abc.jsonl");
  });
});
