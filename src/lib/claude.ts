import fs from "node:fs";
import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/**
 * The single entry point for every LLM call in Ajudan. It runs Claude Code headless
 * through the Agent SDK, so locally it uses your Claude Code login. Before serving
 * other businesses, set ANTHROPIC_API_KEY — no code change needed.
 */

export const MODELS = {
  /** Interviewer, team designer, teammates. */
  main: process.env.AJUDAN_MODEL ?? "claude-opus-5-5",
  /** Cheap helpers: titles, summaries. */
  fast: process.env.AJUDAN_FAST_MODEL ?? "claude-haiku-5-5",
} as const;

export type RunAgentOptions = {
  prompt: string;
  systemPrompt: string;
  /** Folder Claude Code runs in. Created if missing. */
  cwd: string;
  model?: string;
  /** Built-in tools available to the model ([] = none). */
  tools?: string[];
  /** Tools that run without asking (built-in or mcp__server__tool). */
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  /** Called for tools not in allowedTools — use it for the approvals inbox. */
  canUseTool?: CanUseTool;
  /** Resume an earlier Claude Code session for continuity. */
  resume?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  /** Ask for a final JSON answer matching this schema. */
  outputSchema?: z.ZodType;
  onMessage?: (m: SDKMessage) => void;
  abortController?: AbortController;
};

export type RunAgentResult<T = unknown> = {
  text: string;
  structured: T | undefined;
  sessionId: string | undefined;
  costUsd: number;
  ok: boolean;
  error?: string;
};

export async function runAgent<T = unknown>(opts: RunAgentOptions): Promise<RunAgentResult<T>> {
  fs.mkdirSync(opts.cwd, { recursive: true });

  const q = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model ?? MODELS.main,
      systemPrompt: opts.systemPrompt,
      // Isolation: ignore ~/.claude and project settings, hooks, CLAUDE.md and MCP config.
      settingSources: [],
      tools: opts.tools ?? [],
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      mcpServers: opts.mcpServers,
      canUseTool: opts.canUseTool,
      resume: opts.resume,
      maxTurns: opts.maxTurns ?? 30,
      maxBudgetUsd: opts.maxBudgetUsd,
      // Claude Code validates against draft-07; zod defaults to 2020-12.
      outputFormat: opts.outputSchema
        ? { type: "json_schema", schema: z.toJSONSchema(opts.outputSchema, { target: "draft-7" }) as Record<string, unknown> }
        : undefined,
      abortController: opts.abortController,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "ajudan/0.1.0" },
    },
  });

  let sessionId: string | undefined;
  const textParts: string[] = [];
  for await (const m of q) {
    if ("session_id" in m && m.session_id) sessionId = m.session_id;
    opts.onMessage?.(m);
    if (m.type === "assistant") {
      for (const block of m.message.content) if (block.type === "text") textParts.push(block.text);
    }
    if (m.type === "result") {
      if (m.subtype === "success") {
        let structured: T | undefined;
        if (opts.outputSchema) {
          const raw = m.structured_output ?? tryParseJson(m.result);
          const parsed = opts.outputSchema.safeParse(raw);
          if (!parsed.success) {
            return {
              text: m.result,
              structured: undefined,
              sessionId,
              costUsd: m.total_cost_usd,
              ok: false,
              error: `Output did not match schema: ${parsed.error.message}`,
            };
          }
          structured = parsed.data as T;
        }
        return { text: m.result, structured, sessionId, costUsd: m.total_cost_usd, ok: true };
      }
      return {
        text: textParts.join("\n"),
        structured: undefined,
        sessionId,
        costUsd: m.total_cost_usd,
        ok: false,
        error: `Claude run ended with ${m.subtype}${"errors" in m && m.errors ? `: ${JSON.stringify(m.errors)}` : ""}`,
      };
    }
  }
  return { text: textParts.join("\n"), structured: undefined, sessionId, costUsd: 0, ok: false, error: "No result" };
}

function baseName(p: unknown) {
  return String(p ?? "").split("/").pop() || "a file";
}

function tryParseJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : s);
  } catch {
    return undefined;
  }
}

/** One-line human description of a tool call, for the office speech bubble and the feed. */
export function describeToolUse(name: string, input: Record<string, unknown>): string {
  const short = (v: unknown, n = 60) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);
  switch (name) {
    case "WebSearch":
      return `Searching the web: ${short(input.query)}`;
    case "WebFetch":
      return `Reading ${short(input.url)}`;
    case "Read":
      return `Reading ${baseName(input.file_path)}`;
    case "Write":
    case "Edit":
      return `Writing ${baseName(input.file_path)}`;
    case "Glob":
    case "Grep":
      return "Looking through files";
    case "mcp__biz__save_deliverable":
      return `Saving “${short(input.title, 50)}”`;
    case "mcp__biz__list_deliverables":
      return "Checking saved work";
    case "mcp__biz__assign_task":
      return `Handing a task to ${short(input.teammate_name, 30)}`;
    case "mcp__biz__set_status":
      return short(input.text, 70);
    case "mcp__biz__publish_deliverable":
      return "Asking to publish";
    case "mcp__biz__send_message":
      return `Asking to message ${short(input.to, 40)}`;
    default: {
      const n = name.replace(/^mcp__\w+?__/, "").replace(/_/g, " ");
      return `Using ${n}`;
    }
  }
}
