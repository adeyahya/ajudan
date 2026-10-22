import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// worker/handlers/task.ts imports the whole worker graph; `db` is lazy, so pointing
// AJUDAN_DATA_DIR at a temp dir keeps every module away from a real business folder.
process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-fa-data-"));
const { checkFileAccess } = await import("../worker/handlers/task");

let cwd: string;
let skills: string;
let outside: string;

beforeAll(() => {
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-fa-ws-")));
  skills = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-fa-skills-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-fa-out-")));
  fs.writeFileSync(path.join(cwd, "memory.md"), "m");
  fs.mkdirSync(path.join(cwd, "drafts"));
  fs.writeFileSync(path.join(skills, "SKILL.md"), "s");
  fs.writeFileSync(path.join(outside, "secret.txt"), "s");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(cwd, "link.txt"));
  fs.symlinkSync(outside, path.join(cwd, "link-dir"));
});

afterAll(() => {
  for (const d of [cwd, skills, outside, process.env.AJUDAN_DATA_DIR!]) fs.rmSync(d, { recursive: true, force: true });
});

const allow = (r: ReturnType<typeof checkFileAccess>) => r.behavior === "allow";

describe("checkFileAccess", () => {
  it("allows files inside the workspace (existing and new)", () => {
    expect(allow(checkFileAccess("Read", { file_path: path.join(cwd, "memory.md") }, cwd))).toBe(true);
    expect(allow(checkFileAccess("Write", { file_path: path.join(cwd, "drafts", "new", "post.md") }, cwd))).toBe(true);
    expect(allow(checkFileAccess("Edit", { file_path: "memory.md" }, cwd))).toBe(true);
    expect(allow(checkFileAccess("Read", { file_path: cwd }, cwd))).toBe(true);
  });

  it("passes the input through unchanged on allow", () => {
    const input = { file_path: "memory.md" };
    const r = checkFileAccess("Read", input, cwd);
    expect(r).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("denies absolute paths outside the workspace", () => {
    const r = checkFileAccess("Read", { file_path: path.join(outside, "secret.txt") }, cwd);
    expect(r.behavior).toBe("deny");
    expect(r.behavior === "deny" && r.message).toMatch(/outside your workspace/);
    expect(allow(checkFileAccess("Write", { file_path: "/etc/hosts" }, cwd))).toBe(false);
  });

  it("denies relative traversal", () => {
    expect(allow(checkFileAccess("Read", { file_path: "../x" }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Read", { file_path: path.join(cwd, "..", path.basename(outside), "secret.txt") }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Write", { file_path: "drafts/../../escape.md" }, cwd))).toBe(false);
  });

  it("denies a sibling folder whose name starts with the workspace name", () => {
    expect(allow(checkFileAccess("Read", { file_path: `${cwd}-other/x` }, cwd))).toBe(false);
  });

  it("denies symlinks that resolve outside the workspace", () => {
    expect(allow(checkFileAccess("Read", { file_path: path.join(cwd, "link.txt") }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Read", { file_path: path.join(cwd, "link-dir", "secret.txt") }, cwd))).toBe(false);
    // A new file under an escaping symlinked folder: the deepest existing ancestor is outside.
    expect(allow(checkFileAccess("Write", { file_path: path.join(cwd, "link-dir", "new.txt") }, cwd))).toBe(false);
  });

  it("checks every path key", () => {
    expect(allow(checkFileAccess("Read", { path: "/etc/hosts" }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Read", { notebook_path: "/etc/hosts" }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Read", { file_path: "memory.md", path: "/etc/hosts" }, cwd))).toBe(false);
  });

  it("Glob/Grep default to the workspace when no path is given", () => {
    expect(allow(checkFileAccess("Glob", { pattern: "**/*.md" }, cwd))).toBe(true);
    expect(allow(checkFileAccess("Grep", { pattern: "foo" }, cwd))).toBe(true);
  });

  it("denies Glob patterns that reach outside", () => {
    expect(allow(checkFileAccess("Glob", { pattern: "/etc/*" }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Glob", { pattern: "../**/*" }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Glob", { pattern: "~/**" }, cwd))).toBe(false);
    expect(allow(checkFileAccess("Glob", { pattern: "a\\..\\b" }, cwd))).toBe(false);
  });

  it("the blocked path is denied even when the tool input is innocent", () => {
    const blocked = path.join(outside, "secret.txt");
    expect(allow(checkFileAccess("Read", { file_path: "memory.md" }, cwd, blocked))).toBe(false);
  });

  it("read-only folders may be read, globbed and grepped but not written", () => {
    const skill = path.join(skills, "SKILL.md");
    expect(allow(checkFileAccess("Read", { file_path: skill }, cwd, undefined, [skills]))).toBe(true);
    expect(allow(checkFileAccess("Glob", { path: skills, pattern: "**/*.md" }, cwd, undefined, [skills]))).toBe(true);
    expect(allow(checkFileAccess("Grep", { path: skills, pattern: "x" }, cwd, undefined, [skills]))).toBe(true);
    expect(allow(checkFileAccess("Write", { file_path: skill }, cwd, undefined, [skills]))).toBe(false);
    expect(allow(checkFileAccess("Edit", { file_path: skill }, cwd, undefined, [skills]))).toBe(false);
    // Without the read-only list it's just another outside folder.
    expect(allow(checkFileAccess("Read", { file_path: skill }, cwd))).toBe(false);
  });

  it("compares against cwd as given, so a non-canonical cwd denies everything (current behaviour)", () => {
    // On macOS os.tmpdir() is a symlink (/var → /private/var). The candidate is realpath'd
    // but cwd isn't (task.ts resolveReal/isInside), so a workspace reached through a
    // symlink would deny its own files. Callers pass canonical paths today.
    const raw = path.join(os.tmpdir(), path.basename(cwd));
    if (fs.realpathSync(raw) === raw) return; // tmpdir isn't symlinked on this system
    expect(allow(checkFileAccess("Read", { file_path: path.join(raw, "memory.md") }, raw))).toBe(false);
  });
});
