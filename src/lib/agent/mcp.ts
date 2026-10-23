import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONSchema7 } from "ai";
import type { EngineTool, ToolOut } from "./builtin-tools";

/**
 * The run's MCP servers as engine tools, named like Claude Code names them
 * (mcp__<server>__<tool>), so permission checks and activity lines stay the same.
 * In-process servers (createSdkMcpServer: biz, WhatsApp, GitHub) connect in memory;
 * the browser (Playwright) runs over stdio.
 */

/** Rendering a video or waiting on a page can take long; progress keeps a call alive. */
const CALL_TIMEOUT_MS = 30 * 60_000;

export async function connectMcp(servers: Record<string, McpServerConfig>) {
  const clients: Client[] = [];
  const tools: EngineTool[] = [];
  try {
    for (const [name, config] of Object.entries(servers)) {
      const client = new Client({ name: "ajudan", version: "0.1.0" });
      let transport: Transport;
      if (config.type === "sdk") {
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await config.instance.connect(serverSide);
        transport = clientSide;
      } else if (config.type === "http") {
        transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } });
      } else if (config.type === "sse") {
        throw new Error(`MCP server ${name}: SSE servers aren't supported here; use streamable HTTP.`);
      } else {
        transport = new StdioClientTransport({ command: config.command, args: config.args, env: { ...(process.env as Record<string, string>), ...config.env }, stderr: "ignore" });
      }
      await client.connect(transport);
      clients.push(client);
      for (const t of (await client.listTools()).tools) {
        tools.push({
          name: `mcp__${name}__${t.name}`,
          description: t.description ?? t.name,
          inputSchema: t.inputSchema as JSONSchema7,
          async run(input, { signal }) {
            const res = await client.callTool({ name: t.name, arguments: input }, undefined, { signal, timeout: CALL_TIMEOUT_MS, resetTimeoutOnProgress: true });
            return toToolOut(res.content as McpContent[] | undefined, Boolean(res.isError));
          },
        });
      }
    }
  } catch (e) {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    throw e;
  }
  return { tools, close: () => Promise.all(clients.map((c) => c.close().catch(() => {}))).then(() => {}) };
}

type McpContent = { type: string; text?: string; data?: string; mimeType?: string; resource?: { text?: string; uri?: string } };

function toToolOut(content: McpContent[] | undefined, isError: boolean): ToolOut {
  const text: string[] = [];
  const images: ToolOut["images"] = [];
  for (const c of content ?? []) {
    if (c.type === "text" && c.text) text.push(c.text);
    else if (c.type === "image" && c.data && c.mimeType) images.push({ data: c.data, mediaType: c.mimeType });
    else if (c.type === "resource" && c.resource) text.push(c.resource.text ?? c.resource.uri ?? "");
  }
  return { text: text.join("\n") || (images.length ? "(image)" : "(no output)"), images: images.length ? images : undefined, isError };
}
