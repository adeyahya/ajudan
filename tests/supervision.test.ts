import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-supervision-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const sup = await import("@/lib/supervision");
const edits = await import("@/lib/team-edits");
const { backendOf } = await import("@/lib/backend");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const biz = db.insert(schema.businesses).values({ name: "Oru", status: "active" }).returning().get();

describe("supervised mode", () => {
  it("is off by default and switches per business", () => {
    expect(sup.isSupervised(biz.id)).toBe(false);
    sup.setSupervised(biz.id, true);
    expect(sup.isSupervised(biz.id)).toBe(true);
    sup.setSupervised(biz.id, false);
    expect(sup.isSupervised(biz.id)).toBe(false);
  });

  it("only tightens: autopilot asks, draft stays draft", () => {
    expect(sup.effectiveAutonomy("auto", true)).toBe("ask");
    expect(sup.effectiveAutonomy("ask", true)).toBe("ask");
    expect(sup.effectiveAutonomy("draft", true)).toBe("draft");
    expect(sup.effectiveAutonomy("auto", false)).toBe("auto");
  });

  it("asks for team edits the area allows, and leaves the Team permissions as they were", () => {
    expect(sup.editGate(true, true)).toBe("ask");
    expect(sup.editGate(true, false)).toBe("allow");
    // An area that's off: the tool itself refuses, no approval to wait for.
    expect(sup.editGate(false, true)).toBe("allow");
    sup.setSupervised(biz.id, true);
    expect(edits.businessTeamEdits(biz.id)).toEqual(edits.teamEdits(null));
  });
});

describe("AI backend", () => {
  it("defaults to Claude Code", () => {
    expect(backendOf(null)).toEqual({ provider: "claude", baseUrl: "", mainModel: "", fastModel: "" });
  });

  it("fills in the provider's defaults; the fast model falls back to the main one", () => {
    expect(backendOf({ provider: "ollama", mainModel: "qwen3-coder:30b" })).toEqual({ provider: "ollama", baseUrl: "http://localhost:11434", mainModel: "qwen3-coder:30b", fastModel: "qwen3-coder:30b" });
    expect(backendOf({ provider: "ollama", baseUrl: "http://box:11434/v1/", mainModel: "m" }).baseUrl).toBe("http://box:11434");
    const b = backendOf({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1/", mainModel: "a/main", fastModel: "a/fast" });
    expect(b).toEqual({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", mainModel: "a/main", fastModel: "a/fast" });
  });
});
