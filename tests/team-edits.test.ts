import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-team-edits-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const edits = await import("@/lib/team-edits");
const { upsertContact, listContacts } = await import("@/lib/contacts");
const ctx = await import("@/lib/context");
const { grantCapability, requestCapability } = await import("@/lib/capabilities");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const biz = db.insert(schema.businesses).values({ name: "Oru", language: "id", status: "active" }).returning().get();
const mate = db.insert(schema.teammates).values({ businessId: biz.id, name: "Sinta", roleKey: "content_marketer", title: "Writer", status: "active" }).returning().get();

describe("team permissions", () => {
  it("defaults: contacts and schedules on, pages and library off; stored choices win", () => {
    expect(edits.teamEdits(null)).toEqual({ contacts: true, context: false, library: false, schedule: true });
    expect(edits.teamEdits({ contacts: false })).toEqual({ contacts: false, context: false, library: false, schedule: true });
    expect(edits.canTeamEdit(biz.id, "contacts")).toBe(true);
    edits.setTeamEdit(biz.id, "library", true);
    expect(edits.businessTeamEdits(biz.id)).toEqual({ contacts: true, context: false, library: true, schedule: true });
    edits.setTeamEdit(biz.id, "library", false);
  });

  it("approving a request switches the area on", async () => {
    const task = db.insert(schema.tasks).values({ businessId: biz.id, teammateId: mate.id, title: "t", instructions: "Tidy the library" }).returning().get();
    const { approval } = requestCapability({ businessId: biz.id, teammate: mate, taskId: task.id, request: { kind: "edit", area: "library", why: "to tag the new footage" } });
    expect(approval.summary).toContain("organize the media library");
    expect(requestCapability({ businessId: biz.id, teammate: mate, taskId: task.id, request: { kind: "edit", area: "library", why: "again" } }).duplicate).toBe(true);
    await grantCapability(approval, {});
    expect(edits.canTeamEdit(biz.id, "library")).toBe(true);
  });
});

describe("save_contact", () => {
  it("adds someone new, marked as the teammate's", () => {
    const r = upsertContact(biz.id, { name: "Bu Rina", phone: "0812 3456 7890", tags: ["reseller"] }, `teammate:${mate.id}`);
    expect(r).toMatchObject({ created: true, contact: { name: "Bu Rina", phone: "6281234567890", createdBy: `teammate:${mate.id}` } });
  });

  it("updates by phone or name, keeping what it isn't told and adding tags and notes", () => {
    upsertContact(biz.id, { name: "Bu Rina", company: "Toko Rina", notes: "Wants 50 kits" }, "teammate:x");
    const r = upsertContact(biz.id, { phone: "+62 812-3456-7890", tags: ["vip"], notes: "Pays by transfer" }, "teammate:x");
    expect(r).toMatchObject({ created: false });
    const [c] = listContacts(biz.id);
    expect(listContacts(biz.id)).toHaveLength(1);
    expect(c).toMatchObject({ name: "Bu Rina", company: "Toko Rina", phone: "6281234567890", tags: ["reseller", "vip"], notes: "Wants 50 kits\nPays by transfer", createdBy: `teammate:${mate.id}` });
  });

  it("refuses a bad number or an unknown id", () => {
    expect(upsertContact(biz.id, { name: "X", phone: "abc" }, "teammate:x")).toHaveProperty("error");
    expect(upsertContact(biz.id, { id: "nope", notes: "x" }, "teammate:x")).toHaveProperty("error");
  });
});

describe("editing pages directly", () => {
  it("applies the change and keeps it as an accepted suggestion", () => {
    const page = ctx.createPage(biz.id, { title: "Shipping", section: "how_we_work", body: "- JNE\n" });
    ctx.applyPageEdit({ businessId: biz.id, teammate: mate, page, kind: "append", body: "- Free above 100k", reason: "owner said so", source: "chat" });
    const after = ctx.getPage(biz.id, page.id)!;
    expect(after.body).toBe("- JNE\n\n- Free above 100k\n");
    expect(after.updatedBy).toBe(`teammate:${mate.id}`);
    const history = db.select().from(schema.contextSuggestions).all().filter((s) => s.pageId === page.id);
    expect(history).toMatchObject([{ status: "accepted", kind: "append", before: "- JNE\n" }]);
    expect(ctx.pendingSuggestions(biz.id, page.id)).toHaveLength(0);
  });

  it("tells teammates to propose or to write, following the switch", () => {
    ctx.createPage(biz.id, { title: "About", section: "business", body: "We fold paper." });
    expect(ctx.contextPrompt(biz.id, mate.id).prompt).toContain("propose it with suggest_page_edit");
    edits.setTeamEdit(biz.id, "context", true);
    expect(ctx.contextPrompt(biz.id, mate.id).prompt).toContain("edit pages directly");
  });
});
