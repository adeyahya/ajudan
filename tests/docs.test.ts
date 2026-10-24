import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { folderTree, normalizeFolder, renameFolderPath, renameIsCircular } from "@/lib/docs-folders";
import { docMarkdown, exportFilename, markdownToHtml } from "@/lib/docs-export";
import { docsHref, filterDocs, parseDocsFilter, type DocItem } from "@/lib/docs-list";
import { diffMentions, mentionMarkdown, mentionQuery, parseMentions, resolveMentions, stripMentions } from "@/lib/docs-mentions";
import { DOC_TEMPLATES } from "@/lib/docs-templates";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-docs-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const docs = await import("@/lib/docs");
const { addLink, linksFrom } = await import("@/lib/links");
const { historyFor } = await import("@/lib/object-history");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("mentions", () => {
  it("writes and parses mention links, ids encoded", () => {
    const md = `Call ${mentionMarkdown("Ana [VIP]", { type: "contact", id: "c1" })} about ${mentionMarkdown("Logo", { type: "asset", id: "media/brand logo.png" })}.`;
    expect(md).toContain("[Ana VIP](ajudan://contact/c1)");
    expect(md).toContain("ajudan://asset/media%2Fbrand%20logo.png");
    expect(parseMentions(md)).toEqual([
      { type: "contact", id: "c1", label: "Ana VIP" },
      { type: "asset", id: "media/brand logo.png", label: "Logo" },
    ]);
  });

  it("parses each object once and ignores other links", () => {
    const md = "[A](ajudan://doc/p1) [B](ajudan://doc/p1) [web](https://x.id) [bad](ajudan://task/t1)";
    expect(parseMentions(md)).toEqual([{ type: "doc", id: "p1", label: "A" }]);
  });

  it("diffs: adds new, removes dropped", () => {
    const before = [
      { type: "contact" as const, id: "a" },
      { type: "deliverable" as const, id: "d" },
    ];
    const after = [
      { type: "contact" as const, id: "a" },
      { type: "asset" as const, id: "media/x.png" },
    ];
    expect(diffMentions(before, after)).toEqual({ add: [{ type: "asset", id: "media/x.png" }], remove: [{ type: "deliverable", id: "d" }] });
  });

  it("detects the @query being typed", () => {
    expect(mentionQuery("Hi @an")).toBe("an");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("(@sa")).toBe("sa");
    expect(mentionQuery("mail ana@shop")).toBeNull();
    expect(mentionQuery("Hi @ana and")).toBeNull();
  });

  it("resolves to app links for the preview and strips for export", () => {
    const md = "See [Ana](ajudan://contact/c1) and [Logo](ajudan://asset/media%2Flogo.png)";
    const { text, hrefs } = resolveMentions(md, "b1");
    expect(text).toBe("See [Ana](/b/b1/contacts?c=c1) and [Logo](/b/b1/library?f=media%2Flogo.png)");
    expect([...hrefs]).toEqual(["/b/b1/contacts?c=c1", "/b/b1/library?f=media%2Flogo.png"]);
    expect(stripMentions(md)).toBe("See Ana and Logo");
  });
});

describe("folders", () => {
  it("normalizes paths", () => {
    expect(normalizeFolder("  Marketing / /Q3 ")).toBe("Marketing/Q3");
    expect(normalizeFolder("/")).toBeNull();
    expect(normalizeFolder(null)).toBeNull();
  });

  it("renames a folder and everything under it, nothing else", () => {
    expect(renameFolderPath("Marketing", "Marketing", "Sales")).toBe("Sales");
    expect(renameFolderPath("Marketing/Q3", "Marketing", "Sales/2026")).toBe("Sales/2026/Q3");
    expect(renameFolderPath("Marketing2", "Marketing", "Sales")).toBe("Marketing2");
    expect(renameFolderPath(null, "Marketing", "Sales")).toBeNull();
    expect(renameFolderPath("Marketing/Q3", "Marketing", null)).toBe("Q3");
    expect(renameIsCircular("A", "A/B")).toBe(true);
    expect(renameIsCircular("A", "B/A")).toBe(false);
  });

  it("builds a sorted tree with counts and parents", () => {
    const tree = folderTree(["B", "A/x", "A/x", "A", null], ["C"]);
    expect(tree.map((f) => [f.path, f.depth, f.count, f.total])).toEqual([
      ["A", 0, 1, 3],
      ["A/x", 1, 2, 2],
      ["B", 0, 1, 1],
      ["C", 0, 0, 0],
    ]);
  });
});

describe("list filters", () => {
  const items: DocItem[] = [
    { source: "deliverable", id: "1", title: "Promo", kind: "social_post", status: "draft", by: "teammate:t1", folder: "Marketing/Q3", at: 3 },
    { source: "deliverable", id: "2", title: "Quote", kind: "quote", status: "approved", by: "owner", folder: null, at: 2 },
    { source: "context", id: "p", title: "About", kind: "page", status: "context", by: "system", folder: null, at: 1 },
  ];
  const f = (sp: Record<string, string>) => parseDocsFilter(sp);
  const ids = (sp: Record<string, string>, m: Set<string> | null = null) => filterDocs(items, f(sp), m).map((d) => d.id);

  it("filters by source, status, folder and search matches", () => {
    expect(ids({})).toEqual(["1", "2", "p"]);
    expect(ids({ who: "mine" })).toEqual(["2"]);
    expect(ids({ who: "team" })).toEqual(["1", "p"]);
    expect(ids({ status: "context" })).toEqual(["p"]);
    expect(ids({ status: "nope" })).toEqual(["1", "2", "p"]);
    expect(ids({ folder: "Marketing" })).toEqual(["1"]);
    expect(ids({}, new Set(["context:p", "deliverable:2"]))).toEqual(["2", "p"]);
  });

  it("writes URLs without defaults", () => {
    expect(docsHref("b", { who: "all", folder: null })).toBe("/b/b/docs");
    expect(docsHref("b", { who: "team", folder: "A/B" }, { new: "sop" })).toBe("/b/b/docs?who=team&folder=A%2FB&new=sop");
  });
});

describe("export", () => {
  it("escapes HTML and drops unsafe links", () => {
    const html = markdownToHtml("<script>x</script> [a](javascript:alert(1)) [b](https://x.id) **bold** _it_");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://x.id">b</a>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
  });

  it("converts headings, lists, tasks, tables and code", () => {
    const html = markdownToHtml("# T\n\n- a\n  - b\n- [x] done\n\n| A | B |\n| --- | ---: |\n| 1 | 2 |\n\n```\n<b>\n```");
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain("<ul><li>a<ul><li>b</li></ul></li><li class=\"task\"><input type=\"checkbox\" disabled checked> done</li></ul>");
    expect(html).toContain('<th>A</th><th style="text-align:right">B</th>');
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toContain("<pre><code>&lt;b&gt;</code></pre>");
  });

  it("resolves relative images and names files", () => {
    expect(markdownToHtml("![x](media/a.png)", { resolveUrl: (u) => `/f/${u}` })).toContain('<img src="/f/media/a.png" alt="x">');
    expect(docMarkdown({ title: "T", content: "Hi [Ana](ajudan://contact/1)" })).toBe("# T\n\nHi Ana\n");
    expect(exportFilename("Price list (May)", "md")).toBe("Price-list-May.md");
    expect(exportFilename("???", "html")).toBe("doc.html");
  });

  it("every template converts and has both languages", () => {
    for (const tpl of DOC_TEMPLATES) {
      expect(tpl.body.id.length).toBeGreaterThan(20);
      expect(markdownToHtml(tpl.body.en)).toContain("<h2>");
    }
  });
});

describe("saving docs", () => {
  let biz: string;
  let contact: string;
  let other: string;
  beforeAll(() => {
    biz = db.insert(schema.businesses).values({ name: "Shop" }).returning().get().id;
    contact = db.insert(schema.contacts).values({ businessId: biz, name: "Ana" }).returning().get().id;
    other = db.insert(schema.deliverables).values({ businessId: biz, kind: "note", title: "Other", content: "x", createdBy: "owner" }).returning().get().id;
  });
  const base = { kind: "note", channel: "", status: "draft" as const, attachments: [] };

  it("records history and reconciles mention links, keeping hand-made links", () => {
    const r = docs.saveDocument(biz, { ...base, title: "Brief", content: `Ask [Ana](ajudan://contact/${contact}) about [Other](ajudan://deliverable/${other})`, folder: " Plans / Q3 " });
    expect("id" in r).toBe(true);
    const id = (r as { id: string }).id;
    const row = db.select().from(schema.deliverables).where(eq(schema.deliverables.id, id)).get()!;
    expect(row.folder).toBe("Plans/Q3");
    expect(row.createdBy).toBe("owner");
    expect(row.updatedBy).toBe("owner");
    const refs = () =>
      linksFrom(biz, { type: "deliverable", id })
        .map((l) => `${l.type}:${l.id}`)
        .sort();
    expect(refs()).toEqual([`contact:${contact}`, `deliverable:${other}`].sort());

    // A link made by hand, and one a teammate made to something the doc then mentions.
    addLink(biz, { type: "deliverable", id }, { type: "asset", id: "media/a.png" }, "owner");
    const bob = db.insert(schema.contacts).values({ businessId: biz, name: "Bob" }).returning().get().id;
    addLink(biz, { type: "deliverable", id }, { type: "contact", id: bob }, "teammate:t1");
    docs.saveDocument(biz, { ...base, id, title: "Brief", content: `Ask about [Other](ajudan://deliverable/${other}) and [Bob](ajudan://contact/${bob})` });
    // Dropping mentions removes only the owner's mention links; unknown objects aren't linked.
    docs.saveDocument(biz, { ...base, id, title: "Brief", content: `Ask about [Other](ajudan://deliverable/${other}) and [Ghost](ajudan://contact/nope)` });
    expect(refs()).toEqual(["asset:media/a.png", `contact:${bob}`, `deliverable:${other}`].sort());

    const h = historyFor(biz, "deliverable", id);
    expect(h.map((e) => e.action)).toEqual(["update", "update", "create"]);
    expect(h[0].by).toBe("owner");
    expect(h[0].snapshot).not.toHaveProperty("versions");
    expect(fs.existsSync(path.join(dir, "work"))).toBe(true);
  });

  it("refuses an empty title and a trashed doc", () => {
    expect(docs.saveDocument(biz, { ...base, title: " ", content: "" })).toEqual({ error: "Give the doc a title." });
    const id = (docs.saveDocument(biz, { ...base, title: "Gone", content: "" }) as { id: string }).id;
    expect(docs.trashDocs(biz, [id])).toBe(1);
    expect(docs.saveDocument(biz, { ...base, id, title: "Back", content: "" })).toEqual({ error: "Doc not found" });
    expect(docs.listDocItems(biz).some((d) => d.id === id)).toBe(false);
  });

  it("moves, renames folders and marks status in bulk", () => {
    const mk = (title: string, folder: string | null) => (docs.saveDocument(biz, { ...base, title, content: "", folder }) as { id: string }).id;
    const a = mk("A", "Sales");
    const b = mk("B", "Sales/2026");
    const c = mk("C", "Sales_old");
    expect(docs.moveDocs(biz, [c], "Archive")).toBe(1);
    expect(docs.renameFolder(biz, "Sales", "Sales/Inside")).toEqual({ error: "A folder can't go inside itself." });
    expect(docs.renameFolder(biz, "Sales", "Revenue")).toEqual({ moved: 2 });
    const folderOf = (id: string) => db.select({ f: schema.deliverables.folder }).from(schema.deliverables).where(eq(schema.deliverables.id, id)).get()!.f;
    expect([folderOf(a), folderOf(b), folderOf(c)]).toEqual(["Revenue", "Revenue/2026", "Archive"]);
    expect(docs.setDocsStatus(biz, [a, b], "approved")).toBe(2);
    expect(docs.setDocsStatus(biz, [a], "approved")).toBe(0);
    const statuses = db
      .select({ s: schema.deliverables.status })
      .from(schema.deliverables)
      .where(and(eq(schema.deliverables.businessId, biz), eq(schema.deliverables.status, "approved")))
      .all();
    expect(statuses).toHaveLength(2);
  });

  it("lists deliverables and Context pages, and searches both", () => {
    const page = db.insert(schema.contextPages).values({ businessId: biz, title: "Shipping policy", body: "Gratis ongkir Jawa" }).returning().get().id;
    const items = docs.listDocItems(biz);
    expect(items.find((d) => d.id === page)?.status).toBe("context");
    const keys = docs.searchDocKeys(biz, "ongkir")!;
    expect([...keys]).toEqual([`context:${page}`]);
    expect(docs.searchDocKeys(biz, "")).toBeNull();
    // Too short for the trigram index: titles only.
    expect(docs.searchDocKeys(biz, "Sh")!.has(`context:${page}`)).toBe(true);
  });
});
