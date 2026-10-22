import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanRel, listDir, resolveBrowsable } from "@/lib/browse";

describe("cleanRel", () => {
  it("accepts paths under the browsable roots", () => {
    expect(cleanRel("work")).toBe("work");
    expect(cleanRel("work/images/x.png")).toBe("work/images/x.png");
    expect(cleanRel("media/a.mp4")).toBe("media/a.mp4");
    expect(cleanRel("teammates/raka/memory.md")).toBe("teammates/raka/memory.md");
  });

  it("normalizes slashes and trims leading/trailing separators", () => {
    expect(cleanRel("/work/")).toBe("work");
    expect(cleanRel("work\\images\\x.png")).toBe("work/images/x.png");
    expect(cleanRel("work//images/./x.png")).toBe("work/images/x.png");
  });

  it("maps empty, null and '.' to the folder root", () => {
    expect(cleanRel("")).toBe("");
    expect(cleanRel(null)).toBe("");
    expect(cleanRel(undefined)).toBe("");
    expect(cleanRel(".")).toBe("");
    expect(cleanRel("/")).toBe("");
  });

  it("refuses anything outside the roots", () => {
    expect(cleanRel("ajudan.db")).toBeNull();
    expect(cleanRel("backups/x.db")).toBeNull();
    expect(cleanRel("browser/Default/Cookies")).toBeNull();
    expect(cleanRel("workx/a")).toBeNull();
  });

  it("refuses path traversal", () => {
    expect(cleanRel("../etc/passwd")).toBeNull();
    expect(cleanRel("work/../ajudan.db")).toBeNull();
    expect(cleanRel("work/../../x")).toBeNull();
    expect(cleanRel("..\\work")).toBeNull();
  });

  it("'work/..' normalizes to the folder root (current behaviour)", () => {
    // normalize() collapses "work/.." before the ".." check runs, so this means "the root".
    expect(cleanRel("work/..")).toBe("");
  });

  it("refuses dotfiles and dot-folders at any depth", () => {
    expect(cleanRel(".secrets.json")).toBeNull();
    expect(cleanRel("work/.hidden")).toBeNull();
    expect(cleanRel("teammates/raka/.claude/settings.json")).toBeNull();
    expect(cleanRel("work/.")).toBe("work");
  });
});

describe("resolveBrowsable", () => {
  let dir: string;
  let outside: string;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-browse-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-outside-")));
    fs.mkdirSync(path.join(dir, "work", "images"), { recursive: true });
    fs.mkdirSync(path.join(dir, "media"), { recursive: true });
    fs.writeFileSync(path.join(dir, "work", "post.md"), "# Post\n");
    fs.writeFileSync(path.join(dir, "work", "images", "x.png"), "png");
    fs.writeFileSync(path.join(dir, "ajudan.db"), "db");
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");
    // Symlinks: one escaping the business folder, one to another root, one staying inside.
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "work", "escape.txt"));
    fs.symlinkSync(outside, path.join(dir, "work", "escape-dir"));
    fs.symlinkSync(path.join(dir, "ajudan.db"), path.join(dir, "work", "db-link"));
    fs.symlinkSync(path.join(dir, "media"), path.join(dir, "work", "media-link"));
    fs.symlinkSync(path.join(dir, "work", "post.md"), path.join(dir, "work", "same-root.md"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("resolves real files and folders under a root", () => {
    expect(resolveBrowsable("work", dir)).toBe(path.join(dir, "work"));
    expect(resolveBrowsable("work/post.md", dir)).toBe(path.join(dir, "work", "post.md"));
    expect(resolveBrowsable("work/images/x.png", dir)).toBe(path.join(dir, "work", "images", "x.png"));
  });

  it("returns the folder itself for the empty rel", () => {
    expect(resolveBrowsable("", dir)).toBe(dir);
    expect(resolveBrowsable("work/..", dir)).toBe(dir);
  });

  it("returns null without a folder", () => {
    expect(resolveBrowsable("work", null as unknown as string)).toBeNull();
  });

  it("returns null for missing files and unbrowsable paths", () => {
    expect(resolveBrowsable("work/nope.md", dir)).toBeNull();
    expect(resolveBrowsable("ajudan.db", dir)).toBeNull();
    expect(resolveBrowsable("work/../ajudan.db", dir)).toBeNull();
  });

  it("refuses symlinks that lead outside the business folder", () => {
    expect(resolveBrowsable("work/escape.txt", dir)).toBeNull();
    expect(resolveBrowsable("work/escape-dir", dir)).toBeNull();
    expect(resolveBrowsable("work/escape-dir/secret.txt", dir)).toBeNull();
  });

  it("refuses symlinks to unbrowsable files inside the folder", () => {
    expect(resolveBrowsable("work/db-link", dir)).toBeNull();
  });

  it("refuses symlinks that jump to another root", () => {
    // media/ is browsable on its own, but work/ must not alias it.
    expect(resolveBrowsable("work/media-link", dir)).toBeNull();
  });

  it("allows symlinks that stay inside the same root", () => {
    expect(resolveBrowsable("work/same-root.md", dir)).toBe(path.join(dir, "work", "same-root.md"));
  });

  // cleanRel("work/..") becomes "" (browse.ts: normalize runs before the ".." check), and
  // listDir treats a non-empty rel that resolves to the folder itself as a directory to
  // list: the business folder's root (ajudan.db, backups/, browser/) shows up as entries.
  // Their contents stay unreachable (child rels are refused), but the names leak.
  it.fails("listDir('work/..') must not list the business folder root", () => {
    process.env.AJUDAN_DATA_DIR = dir;
    try {
      expect(listDir("work/..")).toBeNull();
    } finally {
      delete process.env.AJUDAN_DATA_DIR;
    }
  });

  it("listDir('work/..') lists the folder root today (current behaviour)", () => {
    process.env.AJUDAN_DATA_DIR = dir;
    try {
      expect(listDir("work/..")?.map((e) => e.name)).toContain("ajudan.db");
    } finally {
      delete process.env.AJUDAN_DATA_DIR;
    }
  });

  it("doesn't treat a sibling with the root as a prefix as inside", () => {
    fs.mkdirSync(path.join(dir, "workspace"));
    fs.writeFileSync(path.join(dir, "workspace", "a.txt"), "a");
    fs.symlinkSync(path.join(dir, "workspace", "a.txt"), path.join(dir, "work", "prefix.txt"));
    expect(resolveBrowsable("work/prefix.txt", dir)).toBeNull();
  });
});
