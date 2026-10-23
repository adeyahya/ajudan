import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-assets-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { findDuplicates, findSameFile, listLibrary, mergeDuplicates, organize } = await import("@/lib/assets");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let businessId: string;
const put = (name: string, body: string, ageMs = 0) => {
  const abs = path.join(dir, "media", name);
  fs.writeFileSync(abs, body);
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(abs, t, t);
  return `media/${name}`;
};

beforeAll(() => {
  fs.mkdirSync(path.join(dir, "media"), { recursive: true });
  businessId = db.insert(schema.businesses).values({ name: "Test" }).returning().get().id;
});

describe("duplicates", () => {
  it("groups same-content files only, and keeps the organized copy", async () => {
    const a = put("a.jpg", "PHOTO", 3000);
    const b = put("b.jpg", "PHOTO", 2000);
    const c = put("c.jpg", "PHOTO", 1000);
    put("d.jpg", "OTHER"); // same size, different bytes
    organize(businessId, [b], { title: "Shop front" });

    const groups = await findDuplicates(businessId);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep).toBe(b);
    expect(groups[0].copies.sort()).toEqual([a, c]);
  });

  it("carries labels over and repoints what used a removed copy", async () => {
    const keep = put("k.png", "LOGO", 2000);
    const copy = put("k-again.png", "LOGO", 1000);
    organize(businessId, [copy], { album: "Brand", note: "Use as the logo", tags: ["logo"] });
    const mate = db.insert(schema.teammates).values({ businessId, name: "Raka", roleKey: "copywriter", title: "Copywriter" }).returning().get();
    const task = db
      .insert(schema.tasks)
      .values({ businessId, teammateId: mate.id, title: "t", instructions: "t", attachments: [copy, "media/other.jpg"] })
      .returning()
      .get();

    expect(await mergeDuplicates(businessId, keep, [copy])).toBe(1);

    expect(fs.existsSync(path.join(dir, copy))).toBe(false);
    const item = listLibrary(businessId).find((i) => i.path === keep)!;
    expect(item).toMatchObject({ album: "Brand", note: "Use as the logo", tags: ["logo"] });
    const after = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()!;
    expect(after.attachments).toEqual([keep, "media/other.jpg"]);
  });

  it("never removes a file whose bytes differ", async () => {
    const x = put("x.mp4", "VIDEO-1");
    const y = put("y.mp4", "VIDEO-2");
    expect(await mergeDuplicates(businessId, x, [y])).toBe(0);
    expect(fs.existsSync(path.join(dir, y))).toBe(true);
  });

  it("finds the file an upload repeats", async () => {
    const orig = put("song.mp3", "TUNE");
    const fresh = put("song-2.mp3", "TUNE");
    expect(await findSameFile(path.join(dir, fresh), fresh)).toBe(orig);
    expect(await findSameFile(path.join(dir, put("new.mp3", "NEW!")), "media/new.mp3")).toBeNull();
  });
});
