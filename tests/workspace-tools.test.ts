import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-workspace-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { searchWorkspace, searchMedia, searchDocs, queryWords } = await import("@/lib/workspace-search");
const { canChange, canCreate, ownerMade } = await import("@/lib/workspace-access");
const { setAgentAccess } = await import("@/lib/agent-access");
const { softDelete } = await import("@/lib/trash");
const { historyFor } = await import("@/lib/object-history");
const { linksFor } = await import("@/lib/links");
const { workspaceTools, parseRef, cleanFolder, contactToChange } = await import("../worker/workspace-tools");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let biz: string;
let mate: string;
let other: string;
let task: string;
beforeAll(() => {
  biz = db.insert(schema.businesses).values({ name: "Shop" }).returning().get().id;
  mate = db.insert(schema.teammates).values({ businessId: biz, name: "Sinta", title: "Writer", roleKey: "writer" }).returning().get().id;
  other = db.insert(schema.teammates).values({ businessId: biz, name: "Budi", title: "Social", roleKey: "social" }).returning().get().id;
  task = db.insert(schema.tasks).values({ businessId: biz, teammateId: mate, title: "Brief", instructions: "Write" }).returning().get().id;
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  for (const f of ["washi-a.jpg", "washi-b.jpg", "unboxing-clip.mp4", "logo.png"]) fs.writeFileSync(path.join(dir, "media", f), "x");
});

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
function toolsFor(teammateId: string) {
  const list = workspaceTools({ businessId: biz, teammate: { id: teammateId, name: "Sinta", title: "Writer", roleKey: "writer" }, taskId: task, roster: [], cwd: path.join(dir, "ws") });
  return (name: string, args: Record<string, unknown>) => (list.find((t) => t.name === name)!.handler as unknown as Handler)(args, {});
}

describe("searchWorkspace ranking", () => {
  it("ranks a starred, owner-labeled file above an equal match", () => {
    db.insert(schema.assets).values({ path: "media/washi-b.jpg", businessId: biz, starred: true, note: "the cover" }).run();
    const hits = searchMedia(biz, "washi");
    expect(hits.map((h) => h.id)).toEqual(["media/washi-b.jpg", "media/washi-a.jpg"]);
    expect(hits[0]).toMatchObject({ type: "asset", starred: true, curated: true, createdBy: "owner" });
    expect(hits[1].curated).toBe(false);
  });

  it("finds unlabeled files by name, filters by kind, and leaves Trash out", () => {
    expect(searchMedia(biz, "unboxing").map((h) => h.id)).toEqual(["media/unboxing-clip.mp4"]);
    expect(searchMedia(biz, "unboxing", { mediaKind: "image" })).toEqual([]);
    softDelete(biz, "asset", "media/washi-a.jpg");
    expect(searchMedia(biz, "washi").map((h) => h.id)).toEqual(["media/washi-b.jpg"]);
  });

  it("boosts contacts with notes and always-read pages; one call covers every type", () => {
    db.insert(schema.contacts).values({ businessId: biz, name: "Rina Reseller" }).run();
    const noted = db.insert(schema.contacts).values({ businessId: biz, name: "Rina Supplier", notes: "pays on time" }).returning().get().id;
    const always = db.insert(schema.contextPages).values({ businessId: biz, title: "Reseller rules", body: "Rina gets 10%", section: "business" }).returning().get().id;
    db.insert(schema.contextPages).values({ businessId: biz, title: "Reseller ideas", body: "Rina maybe", section: "product" }).run();
    const deliv = db.insert(schema.deliverables).values({ businessId: biz, kind: "post", title: "Rina promo", content: "for Rina" }).returning().get().id;

    const contacts = searchWorkspace(biz, "rina", { types: ["contact"] });
    expect(contacts[0].id).toBe(noted);
    const docs = searchDocs(biz, "reseller rina");
    expect(docs[0].id).toBe(always);
    expect(docs.some((h) => h.type === "contact")).toBe(false);
    const all = new Set(searchWorkspace(biz, "rina").map((h) => h.type));
    expect(all).toEqual(new Set(["doc", "deliverable", "contact"]));
    expect(searchWorkspace(biz, "rina", { types: ["deliverable"] })[0]).toMatchObject({ id: deliv, createdBy: "owner", href: `/b/${biz}/docs?doc=${deliv}` });
  });

  it("leaves out pages a teammate may never read, and short or empty queries are safe", () => {
    const secret = db.insert(schema.contextPages).values({ businessId: biz, title: "Margins secret", body: "cost", section: "business" }).returning().get().id;
    db.insert(schema.contextReaders).values({ pageId: secret, teammateId: mate, mode: "never" }).run();
    expect(searchDocs(biz, "margins").map((h) => h.id)).toEqual([secret]);
    expect(searchDocs(biz, "margins", { teammateId: mate })).toEqual([]);
    expect(searchWorkspace(biz, "")).toEqual([]);
    expect(queryWords("#VIP a ok")).toEqual(["vip", "ok"]);
  });
});

describe("access rules", () => {
  it("defaults: docs and contacts suggest, library write", () => {
    expect(canCreate(biz, "docs").ok).toBe(true);
    expect(canChange(biz, "docs", "owner")).toMatchObject({ ok: false, suggest: true });
    expect(canChange(biz, "docs", null).ok).toBe(false); // legacy rows without created_by are the owner's
    expect(canChange(biz, "docs", `teammate:${mate}`).ok).toBe(true);
    expect(canChange(biz, "contacts", "system").ok).toBe(false);
    expect(canChange(biz, "library", "owner").ok).toBe(true);
    expect(ownerMade("teammate:x")).toBe(false);
  });

  it("write opens the owner's objects; read closes even the team's own", () => {
    setAgentAccess(biz, { docs: "write", contacts: "read" });
    expect(canChange(biz, "docs", "owner").ok).toBe(true);
    expect(canChange(biz, "contacts", `teammate:${mate}`)).toMatchObject({ ok: false, suggest: false });
    expect(canCreate(biz, "contacts").ok).toBe(false);
    setAgentAccess(biz, { docs: "suggest", contacts: "suggest" });
  });

  it("parses refs and folders, and finds the contact save_contact would change", () => {
    expect(parseRef("media/x.jpg")).toEqual({ type: "asset", id: "media/x.jpg" });
    expect(parseRef("asset:./media/x.jpg")).toEqual({ type: "asset", id: "media/x.jpg" });
    expect(parseRef("deliverable:abc")).toEqual({ type: "deliverable", id: "abc" });
    expect(parseRef("thing:abc")).toBeNull();
    expect(cleanFolder(" Marketing / Q3/ ")).toBe("Marketing/Q3");
    expect(cleanFolder("")).toBeNull();
    const c = db.insert(schema.contacts).values({ businessId: biz, name: "Pak Joko", phone: "6281234567890" }).returning().get();
    expect(contactToChange(biz, { phone: "+62 812-3456-7890" })?.id).toBe(c.id);
    expect(contactToChange(biz, { name: "pak joko" })?.id).toBe(c.id);
    expect(contactToChange(biz, { name: "Someone new" })).toBeUndefined();
  });
});

describe("workspace tools", () => {
  it("create_doc makes the teammate's own doc with a folder and a history entry", async () => {
    const call = toolsFor(mate);
    const r = await call("create_doc", { title: "Q3 brief", content: "# Plan", folder: "Marketing/ Q3" });
    expect(r.isError).toBeFalsy();
    const d = db.select().from(schema.deliverables).where(eq(schema.deliverables.title, "Q3 brief")).get()!;
    expect(d).toMatchObject({ folder: "Marketing/Q3", createdBy: `teammate:${mate}`, kind: "doc", teammateId: mate });
    expect(historyFor(biz, "deliverable", d.id).map((h) => [h.action, h.by])).toEqual([["create", `teammate:${mate}`]]);
  });

  it("create_doc is refused when docs are read-only", async () => {
    setAgentAccess(biz, { docs: "read" });
    const r = await toolsFor(mate)("create_doc", { title: "Nope", content: "x" });
    expect(r.isError).toBe(true);
    setAgentAccess(biz, { docs: "suggest" });
  });

  it("link_objects links live objects as the teammate; unlink only its own links at suggest", async () => {
    const call = toolsFor(mate);
    const d = db.select().from(schema.deliverables).where(eq(schema.deliverables.title, "Q3 brief")).get()!;
    const r = await call("link_objects", { from: `deliverable:${d.id}`, to: "media/washi-b.jpg" });
    expect(r.isError).toBeFalsy();
    expect(linksFor(biz, { type: "deliverable", id: d.id })[0]).toMatchObject({ type: "asset", id: "media/washi-b.jpg", createdBy: `teammate:${mate}` });
    expect((await call("link_objects", { from: `deliverable:${d.id}`, to: "media/missing.jpg" })).isError).toBe(true);

    const owners = db.insert(schema.deliverables).values({ businessId: biz, kind: "doc", title: "Owner doc", content: "x", createdBy: "owner" }).returning().get();
    db.insert(schema.links).values({ businessId: biz, fromType: "deliverable", fromId: owners.id, toType: "asset", toId: "media/logo.png", createdBy: "owner" }).run();
    expect((await call("unlink_objects", { from: "media/logo.png", to: `deliverable:${owners.id}` })).isError).toBe(true);
    expect((await call("unlink_objects", { from: "media/washi-b.jpg", to: `deliverable:${d.id}` })).isError).toBeFalsy();
    expect(linksFor(biz, { type: "deliverable", id: d.id })).toEqual([]);
  });

  it("tag_objects tags library files (library: write) but not the owner's contacts (contacts: suggest)", async () => {
    const call = toolsFor(mate);
    const owners = db.insert(schema.contacts).values({ businessId: biz, name: "Bu Ani", tags: ["vip"] }).returning().get();
    const mine = db.insert(schema.contacts).values({ businessId: biz, name: "Mas Dodi", tags: ["old"], createdBy: `teammate:${mate}` }).returning().get();
    const r = await call("tag_objects", { refs: ["media/logo.png", `contact:${owners.id}`, `contact:${mine.id}`], add: ["Payday"], remove: ["old"] });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("suggest");
    const logo = db.select().from(schema.assets).where(and(eq(schema.assets.path, "media/logo.png"), eq(schema.assets.businessId, biz))).get()!;
    expect(logo).toMatchObject({ tags: ["payday"], createdBy: "owner", updatedBy: `teammate:${mate}` });
    expect(db.select().from(schema.contacts).where(eq(schema.contacts.id, owners.id)).get()!.tags).toEqual(["vip"]);
    expect(db.select().from(schema.contacts).where(eq(schema.contacts.id, mine.id)).get()!.tags).toEqual(["payday"]);
    const h = historyFor(biz, "contact", mine.id);
    expect(h[0]).toMatchObject({ action: "update", by: `teammate:${mate}` });
    expect((h[0].snapshot.before as { tags: string[] }).tags).toEqual(["old"]); // the previous state, for undo
  });

  it("search_workspace reports refs and who made each item", async () => {
    const r = await toolsFor(other)("search_workspace", { query: "Q3 brief" });
    expect(r.content[0].text).toContain("deliverable:");
    expect(r.content[0].text).toContain("by a teammate");
  });
});
