import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-file-meta-"));
process.env.AJUDAN_DATA_DIR = dir;
const { cachedTitles, metaRows, pruneMeta, stampOf } = await import("@/lib/file-meta");
const { listDir, searchFiles, withDetails } = await import("@/lib/browse");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, body: string, at = Date.now()) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  fs.utimesSync(abs, new Date(at), new Date(at));
  return { rel, ...stampOf(fs.statSync(abs)) };
};

describe("cachedTitles", () => {
  it("reads a file once, then serves it from the cache until it changes", () => {
    const f = put("work/a.md", "# First\n", 1_700_000_000_000);
    let reads = 0;
    const read = (abs: string) => {
      reads++;
      return /^#\s+(.+)$/m.exec(fs.readFileSync(abs, "utf8"))?.[1];
    };
    expect(cachedTitles(dir, [f], read).get("work/a.md")).toBe("First");
    expect(cachedTitles(dir, [f], read).get("work/a.md")).toBe("First");
    expect(reads).toBe(1);

    // Same size, newer mtime: read again.
    const g = put("work/a.md", "# Other\n", 1_700_000_100_000);
    expect(cachedTitles(dir, [g], read).get("work/a.md")).toBe("Other");
    expect(reads).toBe(2);

    // Different size, same mtime: read again.
    const h = put("work/a.md", "# Longer title\n", 1_700_000_100_000);
    expect(cachedTitles(dir, [h], read).get("work/a.md")).toBe("Longer title");
    expect(reads).toBe(3);
  });

  it("caches 'no title' too", () => {
    const f = put("work/plain.md", "just text\n");
    let reads = 0;
    const read = () => (reads++, undefined);
    cachedTitles(dir, [f], read);
    expect(cachedTitles(dir, [f], read).get("work/plain.md")).toBeUndefined();
    expect(reads).toBe(1);
  });
});

describe("listings and search", () => {
  it("show front-matter titles and find files by title", () => {
    put("work/post.md", '---\ntitle: "Payday promo"\n---\nbody');
    const [post] = withDetails((listDir("work", { details: false }) ?? []).filter((e) => e.name === "post.md"));
    expect(post.title).toBe("Payday promo");
    expect(searchFiles("payday").map((e) => e.rel)).toEqual(["work/post.md"]);
    expect(metaRows(dir, ["work/post.md"]).get("work/post.md")?.title).toBe("Payday promo");
  });
});

describe("pruneMeta", () => {
  it("drops rows for files that are gone or changed, keeps the rest", () => {
    const keep = put("work/keep.md", "# Keep\n");
    const gone = put("work/gone.md", "# Gone\n");
    cachedTitles(dir, [keep, gone], () => "t");
    fs.rmSync(path.join(dir, "work/gone.md"));
    pruneMeta(dir);
    const rows = metaRows(dir, ["work/keep.md", "work/gone.md"]);
    expect(rows.has("work/keep.md")).toBe(true);
    expect(rows.has("work/gone.md")).toBe(false);
  });
});
