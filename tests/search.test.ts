import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-search-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { matchIds } = await import("@/lib/search");
const { searchAddressBook } = await import("@/lib/contacts");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let biz: string;
let other: string;
beforeAll(() => {
  biz = db.insert(schema.businesses).values({ name: "Shop" }).returning().get().id;
  other = db.insert(schema.businesses).values({ name: "Other" }).returning().get().id;
});

const addPage = (businessId: string, title: string, body: string) =>
  db.insert(schema.contextPages).values({ businessId, title, body, section: "business" }).returning().get().id;

describe("matchIds", () => {
  it("finds any part of a word, case-insensitively, in this business only", () => {
    const a = addPage(biz, "Shipping", "Gratis ONGKIRnya ke Jawa");
    addPage(other, "Shipping", "Gratis ongkir");
    expect(matchIds("context_pages", biz, ["ongkir"])).toEqual([a]);
    expect(matchIds("context_pages", biz, ["kirnya"])).toEqual([a]);
  });

  it("returns null when no word is long enough for the index", () => {
    expect(matchIds("context_pages", biz, ["ke", "a"])).toBeNull();
  });

  it("follows updates and deletes", () => {
    const id = addPage(biz, "Prices", "Reseller discount 10%");
    expect(matchIds("context_pages", biz, ["reseller"])).toContain(id);
    db.update(schema.contextPages).set({ body: "No discounts" }).where(eq(schema.contextPages.id, id)).run();
    expect(matchIds("context_pages", biz, ["reseller"])).not.toContain(id);
    expect(matchIds("context_pages", biz, ["discounts"])).toContain(id);
    db.delete(schema.contextPages).where(eq(schema.contextPages.id, id)).run();
    expect(matchIds("context_pages", biz, ["discounts"])).not.toContain(id);
  });

  it("all: every word must match", () => {
    const d = db.insert(schema.deliverables).values({ businessId: biz, kind: "post", title: "Payday promo", content: "Sakura washi, 20% off" }).returning().get().id;
    expect(matchIds("deliverables", biz, ["payday", "washi"], { all: true })).toEqual([d]);
    expect(matchIds("deliverables", biz, ["payday", "origami"], { all: true })).toEqual([]);
  });

  it("quotes what the user typed", () => {
    expect(() => matchIds("deliverables", biz, ['"); drop', "or*"])).not.toThrow();
  });

  it("still finds rows in a VACUUM INTO copy (keyed by id, not rowid)", () => {
    const copy = path.join(dir, "copy.db");
    db.run(sql`VACUUM INTO ${copy}`);
    const c = new Database(copy);
    const ids = c.prepare("select id from context_pages_fts where context_pages_fts match ?").all('{title body}: "ongkir"') as { id: string }[];
    const real = c.prepare("select id from context_pages where body like '%ongkir%'").all() as { id: string }[];
    expect(ids.map((r) => r.id).sort()).toEqual(real.map((r) => r.id).sort());
    c.close();
  });
});

describe("searchAddressBook", () => {
  it("uses the index and still requires every word, short ones included", () => {
    db.insert(schema.contacts).values([
      { businessId: biz, name: "Bu Rina", company: "Kertas Jaya", tags: ["vip"] },
      { businessId: biz, name: "Pak Budi", company: "Kertas Jaya" },
    ]).run();
    expect(searchAddressBook(biz, "kertas").map((c) => c.name)).toEqual(["Bu Rina", "Pak Budi"]);
    expect(searchAddressBook(biz, "kertas #vip").map((c) => c.name)).toEqual(["Bu Rina"]);
    expect(searchAddressBook(biz, "bu kertas").map((c) => c.name)).toEqual(["Bu Rina", "Pak Budi"]);
    expect(searchAddressBook(biz, "rina bu").map((c) => c.name)).toEqual(["Bu Rina"]);
    expect(searchAddressBook(biz, "").length).toBe(2);
  });
});
