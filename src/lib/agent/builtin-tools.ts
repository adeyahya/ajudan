import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { JSONSchema7 } from "ai";
import { isPrivateHost } from "@/lib/net";

/**
 * Claude Code's built-in tools, rebuilt for the AI SDK engine with the same names and
 * input fields (Read {file_path}, Bash {command}…). That way the task runner's
 * permission check (canUseTool in worker/handlers/task.ts) and the office's activity
 * lines (describeToolUse) work unchanged on every backend. Paths are checked there,
 * before a tool runs; these tools only resolve them against the run's folder.
 */

export type ToolOut = { text: string; images?: { data: string; mediaType: string }[]; isError?: boolean };

export type EngineTool = {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  run: (input: Record<string, unknown>, ctx: { signal: AbortSignal; toolCallId: string }) => Promise<ToolOut>;
};

type Ctx = { cwd: string; sandbox?: Options["sandbox"]; plugins: string[]; skills: string[] };

const MAX_OUTPUT = 30_000;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", ".next"]);

const str = (v: unknown) => (typeof v === "string" ? v : "");
const fail = (text: string): ToolOut => ({ text, isError: true });
const clip = (s: string, n = MAX_OUTPUT) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters cut)` : s);

function obj(properties: Record<string, JSONSchema7>, required: string[]): JSONSchema7 {
  return { type: "object", properties, required, additionalProperties: false };
}

export function builtinTools(names: string[], ctx: Ctx): EngineTool[] {
  const abs = (p: unknown) => path.resolve(ctx.cwd, str(p));
  const all: EngineTool[] = [
    {
      name: "Read",
      description: "Read a file from your folder (or a skill's folder). Text comes back with line numbers; images (png, jpg, gif, webp) come back as the picture itself, so you can look at frames and designs.",
      inputSchema: obj(
        {
          file_path: { type: "string", description: "Path of the file, relative to your folder or absolute" },
          offset: { type: "number", description: "Line to start at (1-based)" },
          limit: { type: "number", description: "How many lines (default 2000)" },
        },
        ["file_path"],
      ),
      async run(i) {
        const file = abs(i.file_path);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(`No file ${str(i.file_path)}.`);
        const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
        if (type) return { text: `Image ${path.basename(file)}`, images: [{ data: fs.readFileSync(file).toString("base64"), mediaType: type }] };
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const start = Math.max(1, Number(i.offset) || 1);
        const count = Math.max(1, Number(i.limit) || 2000);
        const shown = lines.slice(start - 1, start - 1 + count).map((l, n) => `${String(start + n).padStart(6)}\t${l.slice(0, 2000)}`);
        const more = lines.length > start - 1 + count ? `\n(${lines.length - (start - 1 + count)} more lines; read on with offset)` : "";
        return { text: clip(shown.join("\n")) + more };
      },
    },
    {
      name: "Write",
      description: "Write a file in your folder (creates folders as needed, replaces the file if it exists).",
      inputSchema: obj({ file_path: { type: "string" }, content: { type: "string" } }, ["file_path", "content"]),
      async run(i) {
        const file = abs(i.file_path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, str(i.content));
        return { text: `Wrote ${str(i.file_path)}.` };
      },
    },
    {
      name: "Edit",
      description: "Replace exact text in a file. old_string must appear exactly once, unless replace_all is true.",
      inputSchema: obj(
        { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } },
        ["file_path", "old_string", "new_string"],
      ),
      async run(i) {
        const file = abs(i.file_path);
        if (!fs.existsSync(file)) return fail(`No file ${str(i.file_path)}.`);
        const text = fs.readFileSync(file, "utf8");
        const from = str(i.old_string);
        const n = from ? text.split(from).length - 1 : 0;
        if (!n) return fail("old_string isn't in the file. Read it again and copy the text exactly.");
        if (n > 1 && !i.replace_all) return fail(`old_string appears ${n} times. Add more context to make it unique, or set replace_all.`);
        fs.writeFileSync(file, i.replace_all ? text.split(from).join(str(i.new_string)) : text.replace(from, () => str(i.new_string)));
        return { text: `Edited ${str(i.file_path)} (${i.replace_all ? n : 1} change${n > 1 && i.replace_all ? "s" : ""}).` };
      },
    },
    {
      name: "Glob",
      description: 'Find files by pattern, e.g. "**/*.md" or "work/*.png". Newest first.',
      inputSchema: obj({ pattern: { type: "string" }, path: { type: "string", description: "Folder to search in (default: your folder)" } }, ["pattern"]),
      async run(i) {
        const base = abs(i.path || ".");
        const re = globToRegExp(str(i.pattern));
        const found: { f: string; t: number }[] = [];
        walk(base, (file, st) => {
          const f = path.relative(base, file);
          if (re.test(f)) found.push({ f, t: st.mtimeMs });
          return found.length < 1000;
        });
        found.sort((a, b) => b.t - a.t);
        return { text: found.length ? found.slice(0, 200).map((x) => path.join(str(i.path) || "", x.f) || x.f).join("\n") : "No files match." };
      },
    },
    {
      name: "Grep",
      description: "Search file contents with a regular expression. output_mode: files_with_matches (default), content (matching lines with line numbers) or count.",
      inputSchema: obj(
        {
          pattern: { type: "string" },
          path: { type: "string", description: "File or folder (default: your folder)" },
          glob: { type: "string", description: 'Only files matching this, e.g. "*.md"' },
          output_mode: { type: "string", enum: ["files_with_matches", "content", "count"] },
          "-i": { type: "boolean", description: "Ignore case" },
        },
        ["pattern"],
      ),
      async run(i) {
        let re: RegExp;
        try {
          re = new RegExp(str(i.pattern), i["-i"] ? "i" : "");
        } catch (e) {
          return fail(`Bad pattern: ${(e as Error).message}`);
        }
        const root = abs(i.path || ".");
        const mode = str(i.output_mode) || "files_with_matches";
        const only = i.glob ? new RegExp(`^${str(i.glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`) : null;
        const out: string[] = [];
        let files = 0;
        walk(root, (p, st) => {
          if (st.size > 2_000_000 || (only && !only.test(path.basename(p)))) return true;
          files++;
          const rel = path.relative(ctx.cwd, p) || path.basename(p);
          const lines = fs.readFileSync(p, "utf8").split("\n");
          const hits = lines.flatMap((l, n) => (re.test(l) ? [`${rel}:${n + 1}:${l.slice(0, 300)}`] : []));
          if (hits.length) {
            if (mode === "content") out.push(...hits);
            else out.push(mode === "count" ? `${rel}:${hits.length}` : rel);
          }
          return out.length < 500 && files < 5000;
        });
        return { text: out.length ? clip(out.slice(0, 500).join("\n")) : "No matches." };
      },
    },
    {
      name: "Bash",
      description: "Run a shell command in your sandbox: it can write only in your folder, read your folder and the business's media/ and work/, and reach only the domains the owner allowed.",
      inputSchema: obj(
        {
          command: { type: "string" },
          description: { type: "string", description: "What it does, in a few words" },
          timeout: { type: "number", description: "Milliseconds (default 120000, at most 600000)" },
        },
        ["command"],
      ),
      run: (i, c) => runSandboxed(str(i.command), ctx, c.signal, Math.min(Number(i.timeout) || 120_000, 600_000)),
    },
    {
      name: "WebFetch",
      description: "Fetch a public web page or file and read its text (HTML is turned into plain text).",
      inputSchema: obj({ url: { type: "string" }, prompt: { type: "string", description: "What you're looking for on the page" } }, ["url"]),
      async run(i, c) {
        let url: URL;
        try {
          url = new URL(str(i.url));
        } catch {
          return fail("Not a valid URL.");
        }
        if (!/^https?:$/.test(url.protocol)) return fail("Only http and https pages.");
        if (isPrivateHost(url.hostname)) return fail(`${url.hostname} is a local or private address; WebFetch only reaches public sites.`);
        const res = await fetch(url, { signal: AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]), headers: { "user-agent": "Mozilla/5.0 (Ajudan)" } });
        const type = res.headers.get("content-type") ?? "";
        if (!/text|json|xml|javascript/.test(type)) return fail(`${url.host} sent ${type || "an unknown type"}, not text.`);
        const body = await res.text();
        const text = /html/.test(type) ? htmlToText(body) : body;
        return { text: `${res.status} ${url}\n${i.prompt ? `(looking for: ${str(i.prompt)})\n` : ""}\n${clip(text, 40_000)}`, isError: !res.ok };
      },
    },
    {
      name: "Skill",
      description: `Load a skill's instructions before doing that kind of work. Available: ${ctx.skills.join(", ") || "none"}.`,
      inputSchema: obj({ skill: { type: "string", description: 'e.g. "ajudan-video:campaign-video"' } }, ["skill"]),
      async run(i) {
        const want = str(i.skill);
        if (ctx.skills.length && !ctx.skills.includes(want)) return fail(`No skill ${want}. Available: ${ctx.skills.join(", ")}.`);
        const name = want.split(":").pop() ?? want;
        for (const dir of ctx.plugins) {
          const file = path.join(dir, "skills", name, "SKILL.md");
          if (fs.existsSync(file)) {
            return { text: `Skill folder: ${path.dirname(file)} (Read its other files when the instructions point to them)\n\n${fs.readFileSync(file, "utf8")}` };
          }
        }
        return fail(`Skill ${want} isn't installed.`);
      },
    },
  ];
  return all.filter((t) => names.includes(t.name));
}

/** Every regular file under `root` (or `root` itself), skipping dependency and cache folders, until `visit` returns false. */
function walk(root: string, visit: (file: string, st: fs.Stats) => boolean) {
  const stack = [root];
  while (stack.length) {
    const p = stack.pop()!;
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) if (!SKIP_DIRS.has(e)) stack.push(path.join(p, e));
    } else if (st.isFile() && !visit(p, st)) return;
  }
}

/** "**\/*.md", "work/*.{png,jpg}" → a RegExp over paths relative to the search folder. */
export function globToRegExp(glob: string) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

let sandboxReady: Promise<void> | undefined;

/**
 * Commands run only inside @anthropic-ai/sandbox-runtime (the sandbox Claude Code uses:
 * Seatbelt on macOS, bubblewrap on Linux), with the run's folder limits and, per
 * command, its allowed domains. Without a sandbox nothing runs.
 */
async function runSandboxed(command: string, ctx: Ctx, signal: AbortSignal, timeoutMs: number): Promise<ToolOut> {
  const box = ctx.sandbox;
  if (!box?.enabled) return fail("The shell isn't available in this run.");
  if (!SandboxManager.isSupportedPlatform()) return fail("The shell sandbox isn't supported on this computer, so commands can't run.");
  const home = os.homedir();
  sandboxReady ??= SandboxManager.initialize({
    // Domains are allowed per command (registerCommandNetworkLists), never globally.
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [home], allowWrite: [], denyWrite: [] },
  } satisfies SandboxRuntimeConfig);
  await sandboxReady;
  const fsRules = box.filesystem ?? {};
  const commandId = randomBytes(16).toString("base64url");
  const wrapped = await SandboxManager.wrapWithSandbox(
    command,
    undefined,
    { filesystem: { denyRead: fsRules.denyRead ?? [home], allowRead: fsRules.allowRead ?? [ctx.cwd], allowWrite: fsRules.allowWrite ?? [ctx.cwd], denyWrite: [] } },
    signal,
    { commandId },
  );
  SandboxManager.registerCommandNetworkLists(commandId, { allowedDomains: box.network?.allowedDomains ?? [] });
  try {
    return await new Promise<ToolOut>((resolve) => {
      // A small, clean environment: no API keys or Ajudan settings reach the command.
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: ctx.cwd, LANG: process.env.LANG ?? "en_US.UTF-8", TMPDIR: process.env.TMPDIR ?? "/tmp" } as unknown as NodeJS.ProcessEnv;
      const child = spawn("/bin/sh", ["-c", wrapped], { cwd: ctx.cwd, env, signal, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const add = (b: Buffer) => {
        if (out.length < 200_000) out += b.toString();
      };
      child.stdout.on("data", add);
      child.stderr.on("data", add);
      child.on("error", (e) => resolve(fail(`Couldn't run it: ${e.message}`)));
      child.on("close", (code, sig) => {
        const text = SandboxManager.annotateStderrWithSandboxFailures(commandId, clip(out.trim()) || "(no output)");
        resolve({ text: sig ? `${text}\n(stopped: ${sig === "SIGTERM" ? "took too long" : sig})` : code ? `${text}\n(exit code ${code})` : text, isError: Boolean(code || sig) });
      });
    });
  } finally {
    SandboxManager.unregisterCommandNetworkLists(commandId);
  }
}
