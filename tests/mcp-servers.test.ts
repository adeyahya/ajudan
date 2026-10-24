import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-mcp-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const mcp = await import("@/lib/mcp-servers");
const { grantCapability, requestCapability } = await import("@/lib/capabilities");
const { connectMcp } = await import("@/lib/agent/mcp");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const biz = db.insert(schema.businesses).values({ name: "Oru", language: "en", status: "active" }).returning().get();
const mate = db.insert(schema.teammates).values({ businessId: biz.id, name: "Dimas", roleKey: "ops", title: "Ops", status: "active" }).returning().get();
const task = db.insert(schema.tasks).values({ businessId: biz.id, teammateId: mate.id, title: "t", instructions: "Sync orders to Notion" }).returning().get();
const reload = () => db.select().from(schema.teammates).where(eq(schema.teammates.id, mate.id)).get()!;

describe("checking a requested server", () => {
  it("wants a slug name that isn't Ajudan's own", () => {
    expect(mcp.checkMcpSpec({ name: "Notion!", transport: "stdio", command: "npx" })).toMatch(/slug/);
    expect(mcp.checkMcpSpec({ name: "my__db", transport: "stdio", command: "npx" })).toMatch(/slug/);
    expect(mcp.checkMcpSpec({ name: "biz", transport: "stdio", command: "npx" })).toMatch(/taken/);
    expect(mcp.checkMcpSpec({ name: "notion", transport: "stdio", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"] })).toBeNull();
  });

  it("wants https (plain http only on localhost)", () => {
    expect(mcp.checkMcpSpec({ name: "crm", transport: "http", url: "http://crm.example.com/mcp" })).toMatch(/https/);
    expect(mcp.checkMcpSpec({ name: "crm", transport: "http", url: "http://localhost:3333/mcp" })).toBeNull();
    expect(mcp.checkMcpSpec({ name: "crm", transport: "http", url: "nope" })).toMatch(/URL/);
  });

  it("refuses pasted keys; credentials go in as {{secret.NAME}}", () => {
    const raw = { name: "notion", transport: "stdio" as const, command: "npx", env: { NOTION_TOKEN: "ntn_4Xk29fJd8sQpLm3Vb7Tz1RwYc" } };
    expect(mcp.checkMcpSpec(raw)).toMatch(/looks like a credential/);
    const ok = { ...raw, env: { NOTION_TOKEN: "{{secret.NOTION}}", LOG_LEVEL: "info" } };
    expect(mcp.checkMcpSpec(ok)).toBeNull();
    expect(mcp.specSecrets(ok)).toEqual(["NOTION"]);
    expect(mcp.describeMcpSpec(ok)).toBe("runs `npx` on this computer (outside the sandbox), with the credential NOTION");
  });
});

describe("asking for a server", () => {
  const spec = { name: "notes", transport: "stdio" as const, command: "npx", args: ["-y", "some-mcp"] };

  it("shows the exact command and adds it for the teammate on approval", async () => {
    const { approval } = requestCapability({ businessId: biz.id, teammate: mate, taskId: task.id, request: { kind: "mcp", ...spec, why: "to keep notes" } });
    expect(approval.summary).toBe("Dimas wants new tools, notes: runs `npx -y some-mcp` on this computer (outside the sandbox)");
    expect(requestCapability({ businessId: biz.id, teammate: mate, taskId: task.id, request: { kind: "mcp", ...spec, why: "again" } }).duplicate).toBe(true);
    const granted = await grantCapability(approval, {});
    expect(granted).toContain("mcp__notes__*");
    expect(mcp.findMcpServer(biz.id, "notes")).toMatchObject({ command: "npx", args: ["-y", "some-mcp"], trusted: false, note: "to keep notes" });
    expect(reload().mcpAccess).toEqual(["notes"]);
    const next = db.select().from(schema.tasks).where(eq(schema.tasks.createdBy, "system:capability")).get();
    expect(next?.instructions).toContain("mcp__notes__*");
  });

  it("won't add a server whose credential isn't stored yet", async () => {
    const { approval } = requestCapability({
      businessId: biz.id,
      teammate: mate,
      taskId: task.id,
      request: { kind: "mcp", name: "crm", transport: "http", url: "https://crm.example.com/mcp", headers: { Authorization: "Bearer {{secret.CRM}}" }, why: "read leads" },
    });
    await expect(grantCapability(approval, {})).rejects.toThrow(/CRM first/);
    expect(mcp.findMcpServer(biz.id, "crm")).toBeUndefined();
  });

  it("approves new tools only in the app, not from WhatsApp", async () => {
    const { decide } = await import("@/lib/approvals");
    const { approval } = requestCapability({ businessId: biz.id, teammate: mate, taskId: task.id, request: { kind: "mcp", name: "wa", transport: "stdio", command: "npx", why: "x" } });
    expect(await decide({ businessId: biz.id, approvalId: approval.id, decision: "approved", via: "whatsapp" })).toMatchObject({ ok: false, error: expect.stringMatching(/in the app/) });
  });

  it("names a stored credential that may not go to the server's host", () => {
    db.insert(schema.secrets).values({ businessId: biz.id, name: "CRM2", hosts: ["other.com"] }).run();
    const r = mcp.mcpSecretProblems(biz.id, { name: "crm", transport: "http", url: "https://crm.example.com/mcp", headers: { Authorization: "Bearer {{secret.CRM2}} {{secret.NONE}}" } });
    expect(r).toEqual({ missing: ["NONE"], wrongHost: ["CRM2"], host: "crm.example.com" });
  });

  it("builds run configs, leaving out a server whose credential is gone", async () => {
    db.insert(schema.mcpServers).values({ businessId: biz.id, name: "gone", transport: "stdio", command: "x", env: { K: "{{secret.NOPE}}" } }).run();
    mcp.grantMcpAccess(reload(), "gone");
    const r = await mcp.teammateMcpConfigs(biz.id, reload());
    expect(Object.keys(r.configs)).toEqual(["notes"]);
    expect(r.configs.notes).toMatchObject({ type: "stdio", command: "npx", args: ["-y", "some-mcp"] });
    expect(r.skipped[0]).toMatch(/gone: the credential NOPE/);
  });

  it("removing a server takes it away from everyone", () => {
    const s = mcp.findMcpServer(biz.id, "notes")!;
    mcp.removeMcpServer(biz.id, s.id);
    expect(reload().mcpAccess).toEqual(["gone"]);
  });
});

describe("AI SDK engine", () => {
  it("goes on without an outside server that doesn't start", async () => {
    const r = await connectMcp({ broken: { type: "stdio", command: "/nonexistent/mcp-server" } });
    expect(r.tools).toEqual([]);
    await r.close();
  });
});
