import fs from "node:fs";
import path from "node:path";
import type { ModelMessage } from "ai";
import { CONFIG_DIR } from "@/lib/folders";

/**
 * Conversations of the AI SDK engine, one JSONL file of model messages per session:
 * ~/.ajudan/agent-sessions/projects/<cwd with every character outside A-Z, a-z, 0-9
 * turned into "-">/<session id>.jsonl. Same layout as Claude Code's ~/.claude, so
 * sessionExists (worker/claude-sessions.ts) finds both. A run that pauses for an
 * approval resumes from here.
 */
export const AGENT_SESSIONS_DIR = path.join(CONFIG_DIR, "agent-sessions");

function sessionFile(cwd: string, sessionId: string) {
  return path.join(AGENT_SESSIONS_DIR, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
}

export function loadSession(cwd: string, sessionId: string): ModelMessage[] {
  try {
    return fs
      .readFileSync(sessionFile(cwd, sessionId), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ModelMessage);
  } catch {
    return [];
  }
}

/** Replace the session's messages (written after every step, so a stop loses little). */
export function saveSession(cwd: string, sessionId: string, messages: ModelMessage[]) {
  const file = sessionFile(cwd, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, messages.map((m) => JSON.stringify(m)).join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
