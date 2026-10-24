import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyFilter, cleanFilter, isEmptyFilter, matchesFilter, mergeFilters, sameFilter, type FilterableItem } from "@/lib/library-filter";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-library-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { deleteFromLibrary, isOrganizablePath, isTeamMediaPath, listLibrary, organize } = await import("@/lib/assets");
const { createLibraryView, deleteLibraryView, libraryViewsPath, listLibraryViews, updateLibraryView } = await import("@/lib/library-views");
const { libraryUsage, searchLibrary } = await import("@/lib/library-search");
const { historyFor } = await import("@/lib/object-history");
const { addLink } = await import("@/lib/links");
const { purge, restoreFromTrash } = await import("@/lib/trash");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let biz: string;
let other: string;
const put = (rel: string, body = rel, ageMs = 0) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(abs, t, t);
  return rel;
};

beforeAll(() => {
  biz = db.insert(schema.businesses).values({ name: "Shop" }).returning().get().id;
  other = db.insert(schema.businesses).values({ name: "Other" }).returning().get().id;
});

const item = (v: Partial<FilterableItem> = {}): FilterableItem => ({
  path: "media/a.jpg",
  name: "a.jpg",
  kind: "image",
  title: "",
  note: "",
  tags: [],
  album: null,
  starred: false,
  source: "owner",
  ...v,
});

describe("library filters", () => {
  it("matches kind, source, star, album, every tag and every search word", () => {
    const i = item({ title: "Sakura washi close-up", tags: ["washi", "promo"], album: "Payday", starred: true, source: "team" });
    expect(matchesFilter(i, {})).toBe(true);
    expect(matchesFilter(i, { kind: "image", source: "team", starred: true, album: "Payday", tags: ["washi", "promo"] })).toBe(true);
    expect(matchesFilter(i, { kind: "video" })).toBe(false);
    expect(matchesFilter(i, { source: "owner" })).toBe(false);
    expect(matchesFilter(i, { tags: ["washi", "logo"] })).toBe(false);
    expect(matchesFilter(i, { album: "Other" })).toBe(false);
    expect(matchesFilter(i, { q: "SAKURA close" })).toBe(true);
    expect(matchesFilter(i, { q: "#promo" })).toBe(true);
    expect(matchesFilter(i, { q: "sakura logo" })).toBe(false);
    expect(matchesFilter(item({ starred: false }), { starred: true })).toBe(false);
  });

  it("lets full-text hits pass the text part, never the other filters", () => {
    const i = item({ path: "media/x.mp4", kind: "video" });
    expect(matchesFilter(i, { q: "unboxing" })).toBe(false);
    expect(matchesFilter(i, { q: "unboxing" }, new Set(["media/x.mp4"]))).toBe(true);
    expect(matchesFilter(i, { q: "unboxing", kind: "image" }, new Set(["media/x.mp4"]))).toBe(false);
  });

  it("ranks full-text hits first, the rest keep their order", () => {
    const items = [item({ path: "a", name: "promo-a" }), item({ path: "b", name: "promo-b" }), item({ path: "c", name: "other" })];
    expect(applyFilter(items, { q: "promo" }).map((i) => i.path)).toEqual(["a", "b"]);
    expect(applyFilter(items, { q: "promo" }, ["c", "b"]).map((i) => i.path)).toEqual(["c", "b", "a"]);
    // Without a query the ranking doesn't reorder anything.
    expect(applyFilter(items, {}, ["c"]).map((i) => i.path)).toEqual(["a", "b", "c"]);
  });

  it("cleans, merges and compares filters", () => {
    expect(cleanFilter({ q: "  ", tags: [" #Promo ", "promo", 3], kind: "doc", starred: "yes", source: "team", album: " A ", extra: 1 })).toEqual({
      tags: ["promo"],
      source: "team",
      album: "A",
    });
    expect(isEmptyFilter({ q: " ", tags: [] })).toBe(true);
    expect(isEmptyFilter({ starred: true })).toBe(false);
    expect(mergeFilters({ q: "washi", tags: ["a"], kind: "image", album: "X" }, { q: "sakura", tags: ["b"], kind: "video", starred: true })).toEqual({
      q: "washi sakura",
      tags: ["a", "b"],
      kind: "video",
      starred: true,
      album: "X",
    });
    expect(sameFilter({ tags: ["b", "a"], kind: "image" }, { kind: "image", tags: ["a", "b"], q: "" })).toBe(true);
    expect(sameFilter({ kind: "image" }, { kind: "video" })).toBe(false);
  });
});

describe("smart albums storage", () => {
  it("creates, renames, updates and deletes per business, in a JSON file in the folder", () => {
    expect(listLibraryViews(biz)).toEqual([]);
    const v = createLibraryView(biz, "  Promo   videos ", { kind: "video", tags: ["#Promo"] });
    expect(v.name).toBe("Promo videos");
    expect(v.filter).toEqual({ tags: ["promo"], kind: "video" });
    createLibraryView(other, "Theirs", { starred: true });
    expect(listLibraryViews(biz).map((x) => x.id)).toEqual([v.id]);
    expect(fs.existsSync(libraryViewsPath())).toBe(true);
    expect(libraryViewsPath().startsWith(dir)).toBe(true);

    expect(updateLibraryView(biz, v.id, { name: "Reels" })?.name).toBe("Reels");
    expect(updateLibraryView(biz, v.id, { filter: { source: "team" } })?.filter).toEqual({ source: "team" });
    expect(updateLibraryView(other, v.id, { name: "x" })).toBeNull();
    expect(listLibraryViews(biz)[0]).toMatchObject({ name: "Reels", filter: { source: "team" } });

    expect(deleteLibraryView(other, v.id)).toBe(false);
    expect(deleteLibraryView(biz, v.id)).toBe(true);
    expect(listLibraryViews(biz)).toEqual([]);
    expect(listLibraryViews(other)).toHaveLength(1);
  });

  it("refuses empty names and filters that show everything", () => {
    expect(() => createLibraryView(biz, " ", { starred: true })).toThrow(/name/);
    expect(() => createLibraryView(biz, "All", { q: "  " })).toThrow(/filter/);
  });

  it("survives a broken file", () => {
    fs.writeFileSync(libraryViewsPath(), "{not json");
    expect(listLibraryViews(biz)).toEqual([]);
    createLibraryView(biz, "Starred", { starred: true });
    expect(listLibraryViews(biz)).toHaveLength(1);
  });
});

describe("team outputs, history and trash", () => {
  it("knows which paths the library can organize", () => {
    expect(isTeamMediaPath("work/images/a.png")).toBe(true);
    expect(isTeamMediaPath("work/videos/a.mp4")).toBe(true);
    expect(isTeamMediaPath("work/notes.md")).toBe(false);
    expect(isTeamMediaPath("work/images/../../x.png")).toBe(false);
    expect(isTeamMediaPath("work/images/.hidden.png")).toBe(false);
    expect(isOrganizablePath("media/a.jpg")).toBe(true);
    expect(isOrganizablePath("teammates/x/a.png")).toBe(false);
  });

  it("lists team images and videos only when asked, marked as the team's", () => {
    const up = put("media/upload.jpg", "UP", 5000);
    const made = put("work/images/2026-10-24-banner-ab12.png", "PNG", 1000);
    put("work/images/notes.txt", "not media");
    put("work/videos/teaser.mp4", "MP4", 2000);
    expect(listLibrary(biz).map((i) => i.path)).toEqual([up]);
    const all = listLibrary(biz, { team: true });
    expect(all.map((i) => [i.path, i.source])).toEqual([
      [made, "team"],
      ["work/videos/teaser.mp4", "team"],
      [up, "owner"],
    ]);
  });

  it("records the owner's organizing in object_history, once per real change", () => {
    const made = "work/images/2026-10-24-banner-ab12.png";
    expect(organize(biz, [made], { title: "Payday banner", tags: ["promo"] }, [], "owner")).toBe(1);
    expect(organize(biz, [made], { title: "Payday banner" }, [], "owner")).toBe(1); // no change
    organize(biz, [made], { starred: true }, [], "owner");
    const h = historyFor(biz, "asset", made);
    // Labels are always an update (the first one's `before` is "no labels"), so Undo never trashes the file.
    expect(h.map((e) => e.action)).toEqual(["update", "update"]);
    expect(h.at(-1)!.snapshot.before).toMatchObject({ title: "", tags: [] });
    expect(h.every((e) => e.by === "owner")).toBe(true);
    const row = listLibrary(biz, { team: true }).find((i) => i.path === made)!;
    expect(row).toMatchObject({ title: "Payday banner", tags: ["promo"], starred: true, source: "team" });
    // A teammate's first labels on the owner's upload leave the file the owner's.
    organize(biz, ["media/upload.jpg"], { title: "Upload" }, [], "teammate:x");
    expect(db.select().from(schema.assets).all().find((a) => a.path === "media/upload.jpg")).toMatchObject({ createdBy: "owner", updatedBy: "teammate:x" });
    db.delete(schema.objectHistory).run();
    db.delete(schema.assets).where(eq(schema.assets.path, "media/upload.jpg")).run();
    // Callers that don't say who (older worker code) record nothing.
    organize(biz, ["media/upload.jpg"], { note: "x" });
    expect(historyFor(biz, "asset", "media/upload.jpg")).toEqual([]);
  });

  it("finds files by full-text index and by file name", () => {
    const items = listLibrary(biz, { team: true });
    expect(searchLibrary(biz, "payday", items)).toEqual(["work/images/2026-10-24-banner-ab12.png"]);
    expect(searchLibrary(biz, "teaser", items)).toEqual(["work/videos/teaser.mp4"]);
    expect(searchLibrary(biz, "up", items)).toEqual(["media/upload.jpg"]); // too short for the index: name scan
    expect(searchLibrary(biz, "  ", items)).toEqual([]);
  });

  it("shows where a file is used: docs, tasks and backlinks, without trashed items", () => {
    const rel = "media/upload.jpg";
    const mate = db.insert(schema.teammates).values({ businessId: biz, name: "Raka", roleKey: "copywriter", title: "Copywriter" }).returning().get();
    const task = db.insert(schema.tasks).values({ businessId: biz, teammateId: mate.id, title: "Make a reel", instructions: "t", attachments: [rel] }).returning().get();
    db.insert(schema.tasks).values({ businessId: biz, teammateId: mate.id, title: "Other", instructions: "t", attachments: ["media/upload.jpg.bak"] }).run();
    const doc = db.insert(schema.deliverables).values({ businessId: biz, kind: "doc", title: "Launch plan", content: "", attachments: [rel] }).returning().get();
    db.insert(schema.deliverables).values({ businessId: biz, kind: "doc", title: "Old", content: "", attachments: [rel], deletedAt: new Date() }).run();
    const linked = db.insert(schema.deliverables).values({ businessId: biz, kind: "doc", title: "Brand notes", content: "" }).returning().get();
    addLink(biz, { type: "deliverable", id: linked.id }, { type: "asset", id: rel });
    addLink(biz, { type: "deliverable", id: doc.id }, { type: "asset", id: rel }); // already listed as a doc

    const u = libraryUsage(biz, rel);
    expect(u.deliverables.map((d) => d.title)).toEqual(["Launch plan"]);
    expect(u.deliverables[0].href).toContain(doc.id);
    expect(u.tasks.map((x) => [x.id, x.title])).toEqual([[task.id, "Make a reel"]]);
    expect(u.links.map((l) => l.title)).toEqual(["Brand notes"]);
  });

  it("trashes team files like uploads, and purging removes the file", () => {
    const made = "work/videos/teaser.mp4";
    expect(deleteFromLibrary(biz, [made, "work/notes.md", "media/missing.jpg"])).toBe(1);
    expect(listLibrary(biz, { team: true }).some((i) => i.path === made)).toBe(false);
    expect(historyFor(biz, "asset", made)[0]).toMatchObject({ action: "delete", by: "owner" });
    expect(restoreFromTrash(biz, "asset", made)).toBe(true);
    expect(listLibrary(biz, { team: true }).some((i) => i.path === made)).toBe(true);
    deleteFromLibrary(biz, [made]);
    expect(purge(biz, "asset", made)).toBe(true);
    expect(fs.existsSync(path.join(dir, made))).toBe(false);
  });
});
