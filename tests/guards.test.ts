import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPrivateHost } from "@/lib/net";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-guards-"));
const { fileInside } = await import("../worker/fs-guard");
const { isAllowedBundlePath } = await import("../worker/bundle-guard");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-guard-")));
const cwd = path.join(root, "teammate");
const outside = path.join(root, "outside");
fs.mkdirSync(path.join(cwd, "work"), { recursive: true });
fs.mkdirSync(outside);
fs.writeFileSync(path.join(cwd, "work", "a.png"), "a");
fs.writeFileSync(path.join(outside, "secret.json"), "{}");
fs.symlinkSync(path.join(outside, "secret.json"), path.join(cwd, "work", "link.json"));
fs.symlinkSync(outside, path.join(cwd, "out"));

describe("isPrivateHost", () => {
  it.each(["localhost", "app.localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "[::1]", "::1", "fe80::1", "fd00::1", "::ffff:7f00:1"])("blocks %s", (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });
  it.each(["example.com", "api.openai.com", "8.8.8.8", "172.32.0.1", "2001:4860::8888"])("allows %s", (h) => {
    expect(isPrivateHost(h)).toBe(false);
  });
});

describe("fileInside", () => {
  it("returns a file inside the folder", () => {
    expect(fileInside(cwd, "work/a.png")).toBe(path.join(cwd, "work", "a.png"));
  });
  it("refuses symlinks out, .., absolute paths outside, folders and missing files", () => {
    expect(fileInside(cwd, "work/link.json")).toBeNull();
    expect(fileInside(cwd, "out/secret.json")).toBeNull();
    expect(fileInside(cwd, "../outside/secret.json")).toBeNull();
    expect(fileInside(cwd, path.join(outside, "secret.json"))).toBeNull();
    expect(fileInside(cwd, "work")).toBeNull();
    expect(fileInside(cwd, "work/nope.png")).toBeNull();
  });
});

describe("isAllowedBundlePath", () => {
  const allowed = [cwd, path.join(root, "node_modules")];
  it("allows files in the folder and in node_modules, and data: URIs", () => {
    expect(isAllowedBundlePath(path.join(cwd, "work", "Video.tsx"), allowed)).toBe(true);
    expect(isAllowedBundlePath(path.join(root, "node_modules", "remotion", "index.js"), allowed)).toBe(true);
    expect(isAllowedBundlePath("data:text/plain,hi", allowed)).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isAllowedBundlePath(path.join(outside, "secret.json"), allowed)).toBe(false);
    expect(isAllowedBundlePath(path.join(root, "teammate-other", "x.ts"), allowed)).toBe(false);
    expect(isAllowedBundlePath("relative/x.ts", allowed)).toBe(false);
  });
});
