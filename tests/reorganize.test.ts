import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-reorganize-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const ctx = await import("@/lib/context");
const { planSuggestions, pendingReorganize, requestReorganize, supersedeReorganize, dueReorganizeBusinesses, setReorganizeSchedule, REORGANIZE_SOURCE } = await import("@/lib/reorganize");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const biz = db.insert(schema.businesses).values({ name: "Toko", status: "active" }).returning().get();
const mate = db.insert(schema.teammates).values({ businessId: biz.id, name: "Rina", title: "Manager", roleKey: "manager", color: "#000" }).returning().get();
ctx.ensureContextWorkspace(biz.id);
const shipping = ctx.createPage(biz.id, { title: "Shipping", section: "how_we_work", body: "- JNE only\n" });
const shipping2 = ctx.createPage(biz.id, { title: "Pengiriman", section: "how_we_work", body: "- Free over 500k\n" });
const misc = ctx.createPage(biz.id, { title: "Misc", section: "business", body: "Prices: 100k\n\nTeam: Rina\n" });
const pages = () => ctx.listPages(biz.id);

describe("planSuggestions", () => {
  it("turns a merge into a replace on the page that stays and a delete for the others", () => {
    const out = planSuggestions(pages(), [{ action: "merge", page: shipping.id, merge_from: [shipping2.id], markdown: "- JNE only\n- Free over 500k", reason: "Same topic" }]);
    expect(out.map((s) => [s.kind, s.page?.id])).toEqual([
      ["replace", shipping.id],
      ["delete", shipping2.id],
    ]);
    expect(out[1].reason).toContain('Merged into "Shipping"');
  });

  it("uses each page once, skips database pages and never removes or moves Ajudan's pages", () => {
    const about = ctx.pageByKey(biz.id, "about") ?? ctx.pageByKey(biz.id, "policies")!;
    const contacts = ctx.pageByKey(biz.id, "contacts")!;
    const out = planSuggestions(pages(), [
      { action: "retitle", page: misc.id, title: "Prices & team", reason: "" },
      { action: "delete", page: misc.id, reason: "again" },
      { action: "delete", page: about.id, reason: "" },
      { action: "move", page: about.id, section: "product", reason: "" },
      { action: "retitle", page: contacts.id, title: "People", reason: "" },
      { action: "rewrite", page: shipping.id, markdown: "- JNE only", reason: "no change" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "replace", title: "Prices & team", body: misc.body });
  });

  it("splits into a replace and new pages, and finds pages by exact title", () => {
    const out = planSuggestions(pages(), [{ action: "split", page: "misc", markdown: "Prices: 100k", new_pages: [{ title: "Team", markdown: "Rina" }], reason: "Two topics" }]);
    expect(out.map((s) => s.kind)).toEqual(["replace", "new_page"]);
    expect(out[1]).toMatchObject({ title: "Team", section: "business" });
  });

  it("refuses a new page whose title already exists", () => {
    expect(planSuggestions(pages(), [{ action: "new_page", title: "shipping", markdown: "x", reason: "" }])).toEqual([]);
  });
});

describe("applying a review", () => {
  const add = (s: ReturnType<typeof planSuggestions>[number]) =>
    ctx.createSuggestion({ businessId: biz.id, teammate: mate, page: s.page, kind: s.kind, body: s.body, title: s.title, section: s.section, reason: s.reason, source: `${REORGANIZE_SOURCE}test` });

  it("a rename keeps the owner's edits made since, a move changes the section, a delete removes the page", () => {
    const [rename] = planSuggestions(pages(), [{ action: "retitle", page: misc.id, title: "Prices & team", section: "product", reason: "" }]).map(add);
    ctx.updatePage(biz.id, misc.id, { body: "Prices: 120k\n" });
    expect(ctx.decideSuggestion(biz.id, rename.id, true)).toMatchObject({ ok: true });
    const after = ctx.getPage(biz.id, misc.id)!;
    expect(after).toMatchObject({ title: "Prices & team", section: "product", body: "Prices: 120k\n" });

    const planned = planSuggestions(pages(), [{ action: "merge", page: shipping.id, merge_from: [shipping2.id], markdown: "- JNE only\n- Free over 500k", reason: "" }]).map(add);
    expect(pendingReorganize(biz.id).map((s) => s.id)).toEqual(planned.map((s) => s.id));
    for (const s of planned) expect(ctx.decideSuggestion(biz.id, s.id, true)).toMatchObject({ ok: true });
    expect(ctx.getPage(biz.id, shipping2.id)).toBeUndefined();
    expect(ctx.getPage(biz.id, shipping.id)!.body).toContain("Free over 500k");
    const del = db.select().from(schema.contextSuggestions).where(eq(schema.contextSuggestions.id, planned[1].id)).get();
    expect(del).toMatchObject({ status: "accepted", pageId: null });
  });

  it("a new review supersedes the last one's undecided suggestions", () => {
    planSuggestions(pages(), [{ action: "retitle", page: shipping.id, title: "Shipping rules", reason: "" }]).map(add);
    expect(pendingReorganize(biz.id)).toHaveLength(1);
    supersedeReorganize(biz.id);
    expect(pendingReorganize(biz.id)).toHaveLength(0);
  });
});

describe("runs", () => {
  it("queues one review at a time and knows when the weekly one is due", () => {
    expect(requestReorganize(biz.id)).not.toBeNull();
    expect(requestReorganize(biz.id)).toBeNull();
    expect(dueReorganizeBusinesses()).toEqual([]);
    setReorganizeSchedule(biz.id, true);
    expect(dueReorganizeBusinesses()).toEqual([biz.id]);
    db.update(schema.businesses).set({ contextTidiedAt: new Date() }).where(eq(schema.businesses.id, biz.id)).run();
    expect(dueReorganizeBusinesses()).toEqual([]);
  });
});
