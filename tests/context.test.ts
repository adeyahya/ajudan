import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-context-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const ctx = await import("@/lib/context");
const { recordRejectionNote } = await import("@/lib/feedback");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("reader defaults", () => {
  it("puts business, how-we-work and the owner's feedback in the prompt, the rest when needed", () => {
    expect(ctx.defaultReaderMode({ section: "business", key: null, kind: "page" })).toBe("always");
    expect(ctx.defaultReaderMode({ section: "how_we_work", key: null, kind: "page" })).toBe("always");
    expect(ctx.defaultReaderMode({ section: "team_written", key: "learned", kind: "page" })).toBe("always");
    expect(ctx.defaultReaderMode({ section: "team_written", key: null, kind: "page" })).toBe("when_needed");
    expect(ctx.defaultReaderMode({ section: "product", key: null, kind: "page" })).toBe("when_needed");
    expect(ctx.defaultReaderMode({ section: "business", key: "contacts", kind: "database" })).toBe("when_needed");
  });

  it("an explicit choice wins", () => {
    const page = { id: "p", section: "business" as const, key: null, kind: "page" as const };
    expect(ctx.readerMode(page, "t", [{ pageId: "p", teammateId: "t", mode: "never" }])).toBe("never");
    expect(ctx.readerMode(page, "u", [{ pageId: "p", teammateId: "t", mode: "never" }])).toBe("always");
  });
});

describe("prompt budget", () => {
  it("keeps whole pages under the budget and cuts the rest with a pointer", () => {
    const pages = [
      { id: "a", title: "About", body: "short" },
      { id: "b", title: "Policies", body: "word ".repeat(400) },
      { id: "c", title: "Late", body: "x" },
    ];
    const { text, items } = ctx.budgetPages(pages, { total: 1300, perPage: 1200 });
    expect(items[0]).toEqual({ id: "a", title: "About", chars: 5, truncated: false });
    expect(items[1].truncated).toBe(true);
    expect(text).toContain('read_page("Policies")');
    expect(items[2]).toMatchObject({ id: "c", chars: 0, truncated: true });
    expect(text.length).toBeLessThan(1300 + 200);
  });

  it("shows mentions to agents as @names", () => {
    expect(ctx.forAgents("Ask [@Bu Rina](ajudan://contact/1) about [@Rules](ajudan://page/2)")).toBe("Ask @Bu Rina (contact) about @Rules");
  });
});

describe("suggestions", () => {
  it("appends at the end or replaces", () => {
    expect(ctx.applySuggestion("# P\n\nold\n", { kind: "append", body: "- new\n" })).toBe("# P\n\nold\n\n- new\n");
    expect(ctx.applySuggestion("", { kind: "append", body: "- new" })).toBe("- new\n");
    expect(ctx.applySuggestion("old", { kind: "replace", body: "new" })).toBe("new");
  });

  it("diffs lines", () => {
    const d = ctx.diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(d).toEqual([
      { op: "same", text: "a" },
      { op: "del", text: "b" },
      { op: "add", text: "B" },
      { op: "same", text: "c" },
      { op: "same", text: "d" },
      { op: "add", text: "e" },
    ]);
    expect(ctx.diffLines("", "x\ny")).toEqual([{ op: "add", text: "x" }, { op: "add", text: "y" }]);
    const long = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const compact = ctx.compactDiff(ctx.diffLines(long, long.replace("l10", "L10")), 1);
    expect(compact[0]).toEqual({ op: "skip", count: 9 });
    expect(compact.filter((l) => l.op !== "skip")).toHaveLength(4);
  });
});

describe("normalizeMarkdown", () => {
  it("ignores how the editor writes the same markdown", () => {
    expect(ctx.normalizeMarkdown("* a\n  + b\nline\\\nnext  \n\n\n\nend\n")).toBe("- a\n  - b\nline\nnext\n\nend");
  });
});

describe("search", () => {
  it("ranks title matches first and gives a snippet", () => {
    const pages = [
      { id: "1", title: "Shipping", body: "Free shipping in Java above 100k." },
      { id: "2", title: "About", body: "We ship paper. Shipping takes 2 days." },
      { id: "3", title: "Other", body: "Nothing here" },
    ];
    const hits = ctx.searchPages(pages, "shipping java");
    expect(hits.map((h) => h.id)).toEqual(["1", "2"]);
    expect(hits[0].snippet).toContain("Java");
    expect(ctx.searchPages(pages, "  ")).toEqual([]);
  });
});

describe("the workspace", () => {
  const biz = db
    .insert(schema.businesses)
    .values({
      name: "Oru",
      language: "id",
      status: "active",
      profile: {
        name: "Oru",
        website: null,
        oneLiner: "Paper crafts",
        description: "Handmade origami.",
        products: ["Washi set", "Origami kit"],
        targetCustomers: [],
        channels: [],
        brandVoice: "Warm",
        competitors: [],
        goals: [],
        constraints: [],
        teamNeeds: [],
      },
    })
    .returning()
    .get();
  const mate = db
    .insert(schema.teammates)
    .values({ businessId: biz.id, name: "Sinta", roleKey: "content_marketer", title: "Writer", status: "active" })
    .returning()
    .get();

  it("seeds Ajudan's pages once, in the business language", () => {
    fs.mkdirSync(path.join(dir, "teammates"), { recursive: true });
    fs.writeFileSync(path.join(dir, "teammates", "TEAM.md"), "# Team notes for Oru\n\nWhat the owner told the team about its work: blah.\n\n## Owner feedback and preferences\n- 2026-10-01 — No emojis\n");
    ctx.ensureContextWorkspace(biz.id);
    ctx.ensureContextWorkspace(biz.id);
    const pages = ctx.listPages(biz.id);
    expect(pages.map((p) => p.key).sort()).toEqual(["about", "contacts", "learned", "policies", "products"]);
    expect(pages.find((p) => p.key === "about")!.title).toBe("Tentang Oru");
    expect(pages.find((p) => p.key === "learned")!.body).toContain("No emojis");
    expect(pages.find((p) => p.key === "learned")!.body).not.toContain("What the owner told");
    expect(pages.find((p) => p.key === "products")!.body).toContain("- Washi set");
  });

  it("owner feedback lands on the learned page and TEAM.md follows it", () => {
    recordRejectionNote({ businessId: biz.id, teammateId: mate.id, summary: "Sinta wants to post", note: "Not on Sundays" });
    expect(ctx.pageByKey(biz.id, "learned")!.body).toContain('"Not on Sundays"');
    expect(fs.readFileSync(path.join(dir, "teammates", "TEAM.md"), "utf8")).toContain('"Not on Sundays"');
  });

  it("builds the prompt from always pages and lists the rest; never is left out", () => {
    const about = ctx.pageByKey(biz.id, "about")!;
    const products = ctx.pageByKey(biz.id, "products")!;
    let { prompt, items } = ctx.contextPrompt(biz.id, mate.id);
    expect(items.map((i) => i.id)).toContain(about.id);
    expect(prompt).toContain("- Produk");
    ctx.setReaderMode(biz.id, about.id, mate.id, "never");
    ctx.setReaderMode(biz.id, products.id, mate.id, "always");
    ({ prompt, items } = ctx.contextPrompt(biz.id, mate.id));
    expect(items.map((i) => i.id)).not.toContain(about.id);
    expect(prompt).not.toContain("Tentang Oru");
    expect(prompt).toContain("Washi set");
    expect(ctx.readablePage(biz.id, mate.id, "Tentang Oru")).toHaveProperty("error");
    // Back to the default: no row left behind.
    ctx.setReaderMode(biz.id, about.id, mate.id, "always");
    expect(db.select().from(schema.contextReaders).where(eq(schema.contextReaders.pageId, about.id)).all()).toHaveLength(0);
  });

  it("applies an accepted suggestion and leaves a rejected one", () => {
    const page = ctx.pageByKey(biz.id, "policies")!;
    const s = ctx.createSuggestion({ businessId: biz.id, teammate: mate, page, kind: "append", body: "- Free shipping in Java above 100k", reason: "owner said", source: "chat" });
    expect(ctx.pendingSuggestions(biz.id, page.id)).toHaveLength(1);
    expect(ctx.decideSuggestion(biz.id, s.id, true, "- Free shipping in Java above Rp100k")).toMatchObject({ ok: true });
    const after = ctx.getPage(biz.id, page.id)!;
    expect(after.body.trimEnd().endsWith("- Free shipping in Java above Rp100k")).toBe(true);
    expect(after.blocks).toBeNull();
    expect(after.updatedBy).toBe(`teammate:${mate.id}`);
    expect(ctx.decideSuggestion(biz.id, s.id, false)).toEqual({ error: "already_decided" });

    const n = ctx.createSuggestion({ businessId: biz.id, teammate: mate, kind: "new_page", body: "Hi", title: "Reseller FAQ", section: "how_we_work" });
    const r = ctx.decideSuggestion(biz.id, n.id, true);
    expect(ctx.getPage(biz.id, (r as { pageId: string }).pageId)).toMatchObject({ title: "Reseller FAQ", section: "how_we_work" });
  });

  it("only deletes the owner's own pages", () => {
    expect(ctx.deletePage(biz.id, ctx.pageByKey(biz.id, "about")!.id)).toBe(false);
    const p = ctx.createPage(biz.id, { title: "Scratch", section: "product" });
    expect(ctx.deletePage(biz.id, p.id)).toBe(true);
  });

  it("gives Ajudan's own pages their default icons", () => {
    expect(ctx.pageByKey(biz.id, "about")!.icon).toBe("lucide:store");
    expect(ctx.pageIcon({ icon: null, key: "contacts" })).toBe("lucide:users");
    expect(ctx.pageIcon({ icon: "", key: "contacts" })).toBeNull();
    expect(ctx.pageIcon({ icon: "🍜", key: null })).toBe("🍜");
  });

  it("moves pages in the tree: reorder, nest, carry sub-pages, refuse cycles", () => {
    const a = ctx.createPage(biz.id, { title: "A", section: "product" });
    const b = ctx.createPage(biz.id, { title: "B", section: "product" });
    const c = ctx.createPage(biz.id, { title: "C", section: "product" });
    const top = () => ctx.listPages(biz.id).filter((p) => p.section === "product" && !p.parentId && ["A", "B", "C"].includes(p.title)).map((p) => p.title);
    expect(top()).toEqual(["A", "B", "C"]);
    ctx.movePage(biz.id, c.id, { parentId: null, section: "product", index: 0 });
    expect(top()).toEqual(["C", "A", "B"]);

    // A sub-page takes its parent's section; a new child goes last under it.
    const child = ctx.createPage(biz.id, { title: "Child", section: "business", parentId: a.id });
    expect(ctx.getPage(biz.id, child.id)).toMatchObject({ parentId: a.id, section: "product" });
    expect(ctx.movePage(biz.id, b.id, { parentId: a.id, index: 0 })).toBe(true);
    expect(ctx.listPages(biz.id).filter((p) => p.parentId === a.id).map((p) => p.title)).toEqual(["B", "Child"]);

    // Into its own sub-page, or under a database: refused.
    expect(ctx.movePage(biz.id, a.id, { parentId: b.id })).toBe(false);
    expect(ctx.movePage(biz.id, a.id, { parentId: a.id })).toBe(false);
    expect(ctx.movePage(biz.id, a.id, { parentId: ctx.pageByKey(biz.id, "contacts")!.id })).toBe(false);

    // Another section: the sub-pages come along.
    ctx.updatePage(biz.id, a.id, { section: "how_we_work" });
    expect(ctx.getPage(biz.id, a.id)).toMatchObject({ section: "how_we_work", parentId: null });
    expect(ctx.getPage(biz.id, b.id)!.section).toBe("how_we_work");
    expect(ctx.getPage(biz.id, child.id)!.section).toBe("how_we_work");

    // Icons and covers (only files in the folder).
    ctx.updatePage(biz.id, a.id, { icon: "🍜", cover: "media/a.jpg" });
    expect(ctx.getPage(biz.id, a.id)).toMatchObject({ icon: "🍜", cover: "media/a.jpg" });
    ctx.updatePage(biz.id, a.id, { cover: "../etc/passwd" });
    expect(ctx.getPage(biz.id, a.id)!.cover).toBeNull();
  });

  it("follows the profile until the owner edits the About page", () => {
    const profile = biz.profile!;
    ctx.refreshAboutPage(biz.id, { ...profile, oneLiner: "Paper crafts and gifts" }, "id");
    expect(ctx.pageByKey(biz.id, "about")!.body).toContain("Paper crafts and gifts");
    ctx.updatePage(biz.id, ctx.pageByKey(biz.id, "about")!.id, { body: "Mine now" });
    ctx.refreshAboutPage(biz.id, { ...profile, oneLiner: "Changed again" }, "id");
    expect(ctx.pageByKey(biz.id, "about")!.body).toBe("Mine now");
    expect(ctx.aboutMarkdown(biz.id)).toBe("# Tentang Oru\n\nMine now\n");
  });
});

describe("mind maps", () => {
  const shape = (nodes: ReturnType<typeof ctx.parseMindMap>): unknown[] => nodes.map((n) => (n.children.length ? { [n.text]: shape(n.children) } : n.text));

  it("reads a nested outline and writes it back the same", () => {
    const md = "- Marketing\n  - Instagram\n    - Reels\n  - TikTok\n- Sales\n";
    const map = ctx.parseMindMap(md);
    expect(shape(map)).toEqual([{ Marketing: [{ Instagram: ["Reels"] }, "TikTok"] }, "Sales"]);
    expect(ctx.mindMapToMarkdown(map)).toBe(md);
  });

  it("takes other bullets, tabs, 4-space indents, headings and prose", () => {
    const map = ctx.parseMindMap("* A\n\t+ B\n        1. C\n## Ops\n- Stock\nCheck weekly\n");
    expect(shape(map)).toEqual([{ A: [{ B: ["C"] }] }, { Ops: ["Stock", "Check weekly"] }]);
  });

  it("drops empty ideas but keeps what was under them", () => {
    const map = [{ id: "a", text: "  ", children: [{ id: "b", text: "Kept", children: [] }] }];
    expect(ctx.mindMapToMarkdown(map)).toBe("- Kept\n");
    expect(ctx.mindMapToMarkdown([])).toBe("");
  });
});
