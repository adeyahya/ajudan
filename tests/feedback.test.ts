import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-feedback-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { feedbackEntry, teamNoteEntry, rejectionEntry, recordDeliverableFeedback, recordRejectionNote } = await import("@/lib/feedback");
const { pushVersion, rejectRevision, reviseDeliverable, MAX_VERSIONS } = await import("@/lib/deliverables");
const { roleChecklist, getRole } = await import("@/lib/roles");
const { REVISION } = await import("@/lib/manager");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const date = new Date("2026-10-22T08:00:00Z");

describe("feedback lines", () => {
  it("dates each entry and keeps the owner's words on one line", () => {
    expect(feedbackEntry({ verdict: "changes", title: "Promo post", kind: "social_post", note: "Less\nformal,  please", date })).toBe(
      '- [Owner feedback, 2026-10-22] Needs changes on "Promo post" (social post): "Less formal, please"',
    );
    expect(feedbackEntry({ verdict: "good", title: "Promo post", note: null, date })).toBe(
      '- [Owner feedback, 2026-10-22] Looks good: "Promo post". Keep doing this.',
    );
    expect(teamNoteEntry({ verdict: "good", title: "Blog", kind: "blog_post", by: "Sinta", note: "Love the tone", date })).toBe(
      '- 2026-10-22 — Looks good: "Blog" (blog post, by Sinta): "Love the tone"',
    );
    expect(teamNoteEntry({ verdict: "changes", title: "Blog", by: "Sinta", note: "Too long", date })).toBe(
      '- 2026-10-22 — Needs changes on "Blog" (by Sinta): "Too long"',
    );
    expect(rejectionEntry({ summary: "Raka wants to WhatsApp 3 chats", note: "Never discount", date })).toBe(
      '- 2026-10-22 — Rejected: Raka wants to WhatsApp 3 chats: "Never discount"',
    );
  });
});

describe("deliverable versions", () => {
  const d = { title: "v", content: "c", attachments: [] as string[], versions: [] as ReturnType<typeof pushVersion> };
  it("keeps the replaced version, bounded", () => {
    let versions = pushVersion(d, "t1", date);
    expect(versions).toEqual([{ title: "v", content: "c", attachments: [], savedAt: date.toISOString(), byTeammateId: "t1" }]);
    for (let i = 0; i < MAX_VERSIONS + 5; i++) versions = pushVersion({ ...d, content: `c${i}`, versions }, null, date);
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions.at(-1)!.content).toBe(`c${MAX_VERSIONS + 4}`);
  });

  it("lets the maker and the manager revise, not others or posted work", () => {
    const mine = { teammateId: "a", status: "draft" as const };
    expect(rejectRevision(mine, { id: "a", roleKey: "content_marketer" })).toBeNull();
    expect(rejectRevision(mine, { id: "m", roleKey: "manager" })).toBeNull();
    expect(rejectRevision(mine, { id: "b", roleKey: "seo_specialist" })).toMatch(/another teammate/);
    expect(rejectRevision({ ...mine, status: "published" }, { id: "a", roleKey: "content_marketer" })).toMatch(/posted/);
  });
});

describe("role checklists", () => {
  it("adds the shared checks to every role, and knows the operations role", () => {
    const ops = roleChecklist("operations_assistant");
    expect(ops[0]).toBe(getRole("operations_assistant")!.checklist[0]);
    expect(ops.some((c) => c.includes("Context pages"))).toBe(true);
    expect(roleChecklist(null).length).toBeGreaterThan(0);
    expect(roleChecklist("unknown_role")).toEqual(roleChecklist(null));
  });
});

describe("the owner's verdict on the Work page", () => {
  let businessId: string;
  let maker: typeof schema.teammates.$inferSelect;
  let deliverableId: string;
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

  beforeEach(() => {
    db.delete(schema.businesses).run();
    fs.rmSync(path.join(dir, "teammates"), { recursive: true, force: true });
    businessId = db.insert(schema.businesses).values({ name: "Toko Test" }).returning().get().id;
    maker = db
      .insert(schema.teammates)
      .values({ businessId, name: "Sinta", roleKey: "content_marketer", title: "Writer", status: "active", workspaceDir: "teammates/sinta" })
      .returning()
      .get();
    const task = db.insert(schema.tasks).values({ businessId, teammateId: maker.id, title: "Write", instructions: "Write", sessionId: "s1" }).returning().get();
    deliverableId = db
      .insert(schema.deliverables)
      .values({ businessId, teammateId: maker.id, taskId: task.id, kind: "blog_post", title: "Launch post", content: "Hello" })
      .returning()
      .get().id;
  });

  it("Needs changes: remembered by the maker and the team, and revised by the maker", () => {
    const { deliverable, task } = recordDeliverableFeedback({ businessId, deliverableId, verdict: "changes", note: "Mention free shipping" });
    expect(deliverable.status).toBe("rejected");
    expect(read("teammates/sinta/memory.md")).toContain('Needs changes on "Launch post" (blog post): "Mention free shipping"');
    expect(read("teammates/TEAM.md")).toContain('(blog post, by Sinta): "Mention free shipping"');
    expect(task).toMatchObject({ teammateId: maker.id, createdBy: REVISION, deliverableId, sessionId: "s1" });
    expect(task!.instructions).toContain(`update_deliverable("${deliverableId}"`);

    // A second note before it starts joins the same revision.
    const again = recordDeliverableFeedback({ businessId, deliverableId, verdict: "changes", note: "And a photo" });
    expect(again.task!.id).toBe(task!.id);
    expect(again.task!.instructions).toContain("And a photo");
  });

  it("Needs changes requires a note; Looks good doesn't, and keeps ready-to-post work ready", () => {
    expect(() => recordDeliverableFeedback({ businessId, deliverableId, verdict: "changes", note: " " })).toThrow();
    db.update(schema.deliverables).set({ status: "ready_to_post" }).where(eq(schema.deliverables.id, deliverableId)).run();
    const { deliverable, task } = recordDeliverableFeedback({ businessId, deliverableId, verdict: "good" });
    expect(deliverable.status).toBe("ready_to_post");
    expect(task).toBeUndefined();
    expect(read("teammates/sinta/memory.md")).toContain('Looks good: "Launch post"');
    // A bare "Looks good" is the maker's, not a team lesson.
    expect(fs.existsSync(path.join(dir, "teammates/TEAM.md")) ? read("teammates/TEAM.md") : "").not.toContain("Launch post");
  });

  it("a revision replaces the content and keeps the old version", () => {
    const r = reviseDeliverable({ businessId, deliverableId, by: { id: maker.id, name: maker.name, roleKey: maker.roleKey }, content: "Hello, free shipping!" });
    expect(r.ok).toBe(true);
    const row = db.select().from(schema.deliverables).where(eq(schema.deliverables.id, deliverableId)).get()!;
    expect(row.content).toBe("Hello, free shipping!");
    expect(row.versions.map((v) => v.content)).toEqual(["Hello"]);
    expect(reviseDeliverable({ businessId, deliverableId, by: { id: "x", name: "X", roleKey: "seo_specialist" }, content: "no" }).ok).toBe(false);
  });

  it("a rejected approval's note goes to the teammate and the team", () => {
    recordRejectionNote({ businessId, teammateId: maker.id, summary: "Sinta wants to post in WhatsApp", note: "Not on Sundays" });
    expect(read("teammates/sinta/memory.md")).toContain('[Owner feedback] ');
    expect(read("teammates/TEAM.md")).toContain('"Not on Sundays"');
  });
});
