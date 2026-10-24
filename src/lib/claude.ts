import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  query,
  type CanUseTool,
  type Options,
  type McpServerConfig,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { runWithAiSdk } from "@/lib/agent/run";
import { AGENT_SESSIONS_DIR } from "@/lib/agent/sessions";
import { backendOf, type Backend } from "@/lib/backend";
import { toMs, UsageLimitError } from "@/lib/rest";
import { backendKey } from "@/lib/secrets";

/**
 * The single entry point for every LLM call in Ajudan. It runs Claude Code headless
 * through the Agent SDK, so locally it uses your Claude Code login. Before serving
 * other businesses, set ANTHROPIC_API_KEY — no code change needed. A business can run
 * on OpenRouter or Ollama instead (src/lib/backend.ts): those runs take the AI SDK
 * engine (src/lib/agent/run.ts), with the same options, tools and permission checks.
 */

export const MODELS = {
  /** Interviewer, team designer, teammates. */
  main: process.env.AJUDAN_MODEL ?? "claude-opus-5-5",
  /** Cheap helpers: titles, summaries. */
  fast: process.env.AJUDAN_FAST_MODEL ?? "claude-haiku-5-5",
} as const;

export type RunAgentOptions = {
  /** The business whose AI backend runs this (Business → AI backend). */
  businessId: string;
  prompt: string;
  systemPrompt: string;
  /** Folder Claude Code runs in. Created if missing. */
  cwd: string;
  /** MODELS.main or MODELS.fast; on another backend they map to its main and fast models. */
  model?: string;
  /** Built-in tools available to the model ([] = none). */
  tools?: string[];
  /** Tools that run without asking (built-in or mcp__server__tool). */
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  /** Reasoning effort ("low" for quick replies). */
  effort?: Options["effort"];
  /** Sandbox for Bash (filesystem and network limits), see the SDK's SandboxSettings. */
  sandbox?: Options["sandbox"];
  /** Local plugin folders to load (their skills become available). */
  plugins?: string[];
  /** Skills to enable ("plugin:skill"); needs "Skill" in tools. */
  skills?: string[];
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

/** Assistant errors that mean the usage limit or credits are used up, not a passing hiccup. */
const LIMIT_ERRORS = new Set(["rate_limit", "billing_error"]);
/** Claude Code's own wording when a subscription limit is hit ("…limit reached|1760000000"). */
const LIMIT_TEXT = /usage limit reached|hit your (?:usage )?limit|out of (?:extra )?usage|credit balance is too low/i;

/**
 * Runs Claude Code and returns its result. Throws UsageLimitError (src/lib/rest.ts) when
 * the usage limit stopped the run, so the worker can put the job back and let the team rest.
 */
export async function runAgent<T = unknown>(opts: RunAgentOptions): Promise<RunAgentResult<T>> {
  fs.mkdirSync(opts.cwd, { recursive: true });
  const backend = businessBackend(opts.businessId);
  if (backend.provider !== "claude") {
    // OpenRouter and Ollama run on the AI SDK engine (src/lib/agent/run.ts), not Claude Code.
    const key = backend.provider === "openrouter" ? await backendKey(opts.businessId) : null;
    if (backend.provider === "openrouter" && !key) {
      return { text: "", structured: undefined, sessionId: undefined, costUsd: 0, ok: false, error: "No OpenRouter API key: add it in Business → AI backend." };
    }
    return runWithAiSdk<T>(opts, backend, modelFor(backend, opts.model), key);
  }

  const q = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: modelFor(backend, opts.model),
      systemPrompt: opts.systemPrompt,
      // Isolation: ignore ~/.claude and project settings, hooks, CLAUDE.md and MCP config.
      settingSources: [],
      tools: opts.tools ?? [],
      allowedTools: opts.allowedTools,
      disallowedTools: opts.disallowedTools,
      mcpServers: opts.mcpServers,
      plugins: opts.plugins?.map((p) => ({ type: "local" as const, path: p })),
      sandbox: opts.sandbox,
      effort: opts.effort,
      skills: opts.skills,
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
  let limited = false;
  let rejected = false;
  let resetsAt: number | undefined;
  for await (const m of q) {
    if ("session_id" in m && m.session_id) sessionId = m.session_id;
    if (m.type === "rate_limit_event") {
      const info = m.rate_limit_info;
      rejected = info.status === "rejected" && info.overageStatus !== "allowed" && info.overageStatus !== "allowed_warning";
      if (info.status === "rejected") resetsAt = toMs(info.resetsAt) ?? resetsAt;
      continue;
    }
    if (m.type === "assistant" && m.error && LIMIT_ERRORS.has(m.error)) {
      limited = true;
      continue; // the synthetic "limit reached" message is not the teammate talking
    }
    opts.onMessage?.(m);
    if (m.type === "assistant") {
      for (const block of m.message.content) if (block.type === "text") textParts.push(block.text);
    }
    if (m.type === "result") {
      const said = m.subtype === "success" ? m.result : "";
      const costUsd = m.total_cost_usd;
      if (limited || (rejected && m.subtype !== "success") || (m.subtype === "success" && m.num_turns <= 1 && LIMIT_TEXT.test(said) && said.length < 300)) {
        throw new UsageLimitError(resetsAt ?? toMs(Number(said.match(/\|(\d{10,13})\b/)?.[1])));
      }
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
              costUsd,
              ok: false,
              error: `Output did not match schema: ${parsed.error.message}`,
            };
          }
          structured = parsed.data as T;
        }
        return { text: m.result, structured, sessionId, costUsd, ok: true };
      }
      return {
        text: textParts.join("\n"),
        structured: undefined,
        sessionId,
        costUsd,
        ok: false,
        error: `Claude run ended with ${m.subtype}${"errors" in m && m.errors ? `: ${JSON.stringify(m.errors)}` : ""}`,
      };
    }
  }
  return { text: textParts.join("\n"), structured: undefined, sessionId, costUsd: 0, ok: false, error: "No result" };
}

/** Where this business's sessions are kept (for resuming them): Claude Code's, or the AI SDK engine's. */
export function claudeConfigDir(businessId: string) {
  return businessBackend(businessId).provider === "claude" ? path.join(os.homedir(), ".claude") : AGENT_SESSIONS_DIR;
}

/**
 * The model for a run: callers ask for MODELS.main or MODELS.fast, and the business's
 * backend says which model that is (Business → AI backend; blank on Claude = MODELS).
 */
function modelFor(backend: Backend, requested: string | undefined) {
  const fast = requested === MODELS.fast;
  if (backend.provider === "claude") return fast ? backend.fastModel || MODELS.fast : backend.mainModel || MODELS.main;
  return fast ? backend.fastModel : backend.mainModel;
}

/** The business's backend, read per run so a switch applies to the next run. */
function businessBackend(businessId: string): Backend {
  const row = db.select({ b: schema.businesses.aiBackend }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  return backendOf(row?.b);
}

function hostOf(url: unknown) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return String(url ?? "a page").slice(0, 40);
  }
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
    case "Bash":
      return `Running ${short(input.description ?? input.command, 50)}`;
    case "mcp__biz__http_request":
      return `Calling ${hostOf(input.url)}`;
    case "mcp__biz__request_capability":
      return `Asking the owner for ${short(input.kind, 20).replace("_", " ")}`;
    case "mcp__biz__list_secrets":
      return "Checking credentials";
    case "mcp__biz__transcribe_media":
      return `Listening to ${baseName(input.file)}`;
    case "Skill":
      return `Studying ${short(input.skill ?? input.command, 40)}`;
    case "mcp__biz__list_media":
      return "Looking through the media library";
    case "mcp__biz__search_contacts":
      return `Looking up ${short(input.query, 30) || "people"} in the address book`;
    case "mcp__biz__save_contact":
      return `Saving ${short(input.name, 30) || "a contact"} to the address book`;
    case "mcp__biz__organize_media":
      return "Organizing the media library";
    case "mcp__biz__set_schedule":
      return input.cron ? "Setting a recurring schedule" : "Clearing the recurring schedule";
    case "mcp__biz__search_context":
      return `Searching the business context for "${short(input.query, 30)}"`;
    case "mcp__biz__read_page":
      return `Reading the page "${short(input.page, 40)}"`;
    case "mcp__biz__suggest_page_edit":
      return `Suggesting a change to "${short(input.page ?? input.title, 40)}"`;
    case "mcp__biz__inspect_media":
      return `Checking ${baseName(input.file)}`;
    case "mcp__biz__extract_frames":
      return `Watching ${baseName(input.file)}`;
    case "mcp__biz__render_video":
      return `Rendering video ${baseName(input.file)}`;
    case "mcp__biz__find_free_assets":
      return `Searching free ${String(input.type ?? "assets").replace("_", " ")}: ${short(input.query, 40)}`;
    case "mcp__biz__download_free_asset":
      return "Downloading a free asset";
    case "mcp__biz__render_image":
      return `Designing ${short(input.name, 40)}`;
    case "mcp__biz__save_deliverable":
      return `Saving “${short(input.title, 50)}”`;
    case "mcp__biz__search_workspace":
    case "mcp__biz__search_docs":
      return `Searching the workspace for "${short(input.query, 30)}"`;
    case "mcp__biz__search_media":
      return `Searching the media library for "${short(input.query, 30)}"`;
    case "mcp__biz__create_doc":
      return `Writing the doc “${short(input.title, 50)}”`;
    case "mcp__biz__link_objects":
      return "Linking related work";
    case "mcp__biz__unlink_objects":
      return "Removing a link";
    case "mcp__biz__tag_objects":
      return "Tagging files and contacts";
    case "mcp__biz__list_deliverables":
      return "Checking saved work";
    case "mcp__biz__assign_task":
      return `Handing a task to ${short(input.teammate_name, 30)}`;
    case "mcp__biz__set_status":
      return short(input.text, 70);
    case "mcp__biz__mark_ready_to_post":
      return `Marking ready to post on ${short(input.channel, 30)}`;
    case "mcp__biz__draft_outbound_message":
      return `Drafting a message to ${short(input.to, 40)}`;
    case "mcp__biz__confirm_browser_action":
      return `Asking before: ${short(input.action, 60)}`;
    // WhatsApp (wacli)
    case "mcp__whatsapp__list_chats":
      return "Checking WhatsApp chats";
    case "mcp__whatsapp__read_messages":
      return `Reading WhatsApp: ${short(input.chat, 40)}`;
    case "mcp__whatsapp__search_messages":
      return `Searching WhatsApp: ${short(input.query, 40)}`;
    case "mcp__whatsapp__update_group":
      return `Updating WhatsApp group: ${short(input.chat, 40)}`;
    case "mcp__whatsapp__invite_link":
      return `Getting invite link: ${short(input.chat, 40)}`;
    case "mcp__whatsapp__create_group":
      return `Creating WhatsApp group: ${short(input.name, 40)}`;
    case "mcp__whatsapp__waiting_for_replies":
      return "Checking who hasn't replied";
    case "mcp__whatsapp__stop_waiting":
      return `Done waiting for ${short(input.chat, 30)}`;
    case "mcp__whatsapp__find_contact":
      return `Looking up ${short(input.query, 30)} in contacts`;
    case "mcp__whatsapp__send_to_people":
      return `Messaging ${(input.recipients as unknown[] | undefined)?.length ?? "several"} people on WhatsApp`;
    case "mcp__whatsapp__send_message":
    case "mcp__whatsapp__send_file":
      return `Posting in WhatsApp: ${short(input.chat, 40)}`;
    // Code repositories and GitHub issues (worker/github-tools.ts)
    case "mcp__github__list_repos":
      return "Checking the code repositories";
    case "mcp__github__git_log":
      return `Reading the history of ${short(input.repo, 30)}`;
    case "mcp__github__list_issues":
    case "mcp__github__view_issue":
      return `Reading GitHub issues of ${short(input.repo, 30)}`;
    case "mcp__github__list_labels":
      return `Checking labels of ${short(input.repo, 30)}`;
    case "mcp__github__create_issues":
      return `Opening ${(input.issues as unknown[] | undefined)?.length ?? "some"} GitHub issues in ${short(input.repo, 30)}`;
    case "mcp__github__comment_issue":
      return `Commenting on ${short(input.repo, 30)} #${short(input.number, 8)}`;
    // Business browser (Playwright MCP)
    case "mcp__browser__browser_navigate":
      return `Opening ${hostOf(input.url)}`;
    case "mcp__browser__browser_navigate_back":
      return "Going back";
    case "mcp__browser__browser_snapshot":
      return "Reading the page";
    case "mcp__browser__browser_take_screenshot":
      return "Looking at the page";
    case "mcp__browser__browser_click":
      return `Clicking “${short(input.element, 40)}”`;
    case "mcp__browser__browser_type":
    case "mcp__browser__browser_fill_form":
      return `Typing into ${short(input.element ?? "a form", 40)}`;
    case "mcp__browser__browser_select_option":
      return `Choosing in “${short(input.element, 40)}”`;
    case "mcp__browser__browser_press_key":
      return `Pressing ${short(input.key, 20)}`;
    case "mcp__browser__browser_wait_for":
      return "Waiting for the page";
    case "mcp__browser__browser_tabs":
      return "Switching tabs";
    default: {
      const n = name.replace(/^mcp__\w+?__/, "").replace(/_/g, " ");
      return `Using ${n}`;
    }
  }
}
