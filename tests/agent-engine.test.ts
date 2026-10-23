import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createSdkMcpServer, tool, type CanUseTool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The AI SDK engine end to end against a fake OpenAI-compatible server standing in for
 * Ollama: tool calls go through canUseTool, an approval stop keeps the conversation and
 * the decision resumes it, MCP tools run, and structured output parses.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-engine-"));
process.env.AJUDAN_DATA_DIR = dir;
const { db, schema } = await import("@/db");
const { runAgent } = await import("@/lib/claude");
const { loadSession } = await import("@/lib/agent/sessions");
const { globToRegExp } = await import("@/lib/agent/builtin-tools");

type Reply = { content?: string; calls?: { name: string; args: Record<string, unknown> }[] };
let script: Reply[] = [];
const requests: { messages: { role: string; content: unknown; tool_calls?: unknown }[]; tools?: { function: { name: string } }[]; response_format?: unknown }[] = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests.push(JSON.parse(body));
    const r = script.shift() ?? { content: "(script ran out)" };
    const calls = r.calls?.map((c, i) => ({ id: `call_${requests.length}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "x",
        object: "chat.completion",
        created: 0,
        model: "fake",
        choices: [{ index: 0, message: { role: "assistant", content: r.content ?? null, tool_calls: calls }, finish_reason: calls ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
});

let biz: { id: string };
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  biz = db.insert(schema.businesses).values({ name: "Engine", status: "active", aiBackend: { provider: "ollama", baseUrl: `http://127.0.0.1:${port}`, mainModel: "fake-main", fastModel: "fake-fast" } }).returning().get();
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cwd = path.join(dir, "mate");
const pingServer = () =>
  createSdkMcpServer({ name: "t", version: "0.1.0", tools: [tool("ping", "Answer pong", { who: z.string() }, async (a) => ({ content: [{ type: "text", text: `pong ${a.who}` }] }))] });

describe("AI SDK engine", () => {
  it("runs tools through the permission check and MCP, and reports Claude Code-shaped messages", async () => {
    script = [{ calls: [{ name: "Write", args: { file_path: "notes.md", content: "hello" } }, { name: "mcp__t__ping", args: { who: "sinta" } }] }, { content: "Done." }];
    const asked: string[] = [];
    const canUseTool: CanUseTool = async (name, input) => {
      asked.push(name);
      return { behavior: "allow", updatedInput: { ...input, content: "hello (checked)" } };
    };
    const seen: SDKMessage[] = [];
    const r = await runAgent({ businessId: biz.id, cwd, prompt: "Write a note", systemPrompt: "You help.", tools: ["Read", "Write"], allowedTools: ["mcp__t__ping"], mcpServers: { t: pingServer() }, canUseTool, onMessage: (m) => seen.push(m) });

    expect(r).toMatchObject({ ok: true, text: "Done.", costUsd: 0 });
    expect(asked).toEqual(["Write"]); // ping is allowed outright
    expect(fs.readFileSync(path.join(cwd, "notes.md"), "utf8")).toBe("hello (checked)"); // updatedInput is what ran
    expect(requests[0].tools?.map((t) => t.function.name).sort()).toEqual(["Read", "Write", "mcp__t__ping"]);
    expect(JSON.stringify(requests[1].messages)).toContain("pong sinta");
    const toolUses = seen.flatMap((m) => (m.type === "assistant" ? m.message.content.filter((b) => b.type === "tool_use").map((b) => (b as { name: string }).name) : []));
    expect(toolUses).toEqual(["Write", "mcp__t__ping"]);
    expect(seen.every((m) => "session_id" in m && m.session_id === r.sessionId)).toBe(true);
  });

  it("stops for an approval, keeps the call, and resumes with the decision", async () => {
    requests.length = 0;
    script = [{ content: "Let me post it.", calls: [{ name: "mcp__t__ping", args: { who: "customer" } }] }];
    const ac = new AbortController();
    const wait = new Error("Waiting for the owner's approval");
    const canUseTool: CanUseTool = async () => {
      ac.abort(wait);
      return { behavior: "deny", message: "Waiting for the owner's approval." };
    };
    let sessionId: string | undefined;
    await expect(
      runAgent({ businessId: biz.id, cwd, prompt: "Ping the customer", systemPrompt: "You help.", mcpServers: { t: pingServer() }, canUseTool, abortController: ac, onMessage: (m) => (sessionId ??= (m as { session_id?: string }).session_id) }),
    ).rejects.toBe(wait);
    expect(ac.signal.reason).toBe(wait);
    const kept = loadSession(cwd, sessionId!);
    expect(JSON.stringify(kept)).toContain("mcp__t__ping");
    expect(JSON.stringify(kept)).toContain("Waiting for the owner's approval.");

    script = [{ content: "Sent after your OK." }];
    const r = await runAgent({ businessId: biz.id, cwd, prompt: "The owner approved: go ahead.", systemPrompt: "You help.", resume: sessionId });
    expect(r).toMatchObject({ ok: true, text: "Sent after your OK.", sessionId });
    const sent = JSON.stringify(requests.at(-1)?.messages);
    expect(sent).toContain("Ping the customer");
    expect(sent).toContain("The owner approved");
  });

  it("returns structured output and maps the fast model", async () => {
    requests.length = 0;
    script = [{ content: '{"answer":"42","cited":["Prices"]}' }];
    const r = await runAgent({ businessId: biz.id, cwd, model: "claude-haiku-5-5", prompt: "?", systemPrompt: "Answer.", outputSchema: z.object({ answer: z.string(), cited: z.array(z.string()) }) });
    expect(r).toMatchObject({ ok: true, structured: { answer: "42", cited: ["Prices"] } });
    expect(JSON.stringify(requests[0])).toContain("fake-fast");
  });

  it("denies tools that aren't allowed when there's no permission check", async () => {
    script = [{ calls: [{ name: "Read", args: { file_path: "notes.md" } }] }, { content: "Couldn't." }];
    const r = await runAgent({ businessId: biz.id, cwd, prompt: "Read", systemPrompt: "x", tools: ["Read"] });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain("isn't available in this run");
  });
});

describe("Glob patterns", () => {
  it("matches like Claude Code's Glob", () => {
    expect(globToRegExp("**/*.md").test("a/b/c.md")).toBe(true);
    expect(globToRegExp("**/*.md").test("c.md")).toBe(true);
    expect(globToRegExp("work/*.{png,jpg}").test("work/x.jpg")).toBe(true);
    expect(globToRegExp("work/*.png").test("work/sub/x.png")).toBe(false);
  });
});
