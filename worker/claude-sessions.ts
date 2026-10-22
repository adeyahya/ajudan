import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where Claude Code keeps a session's transcript: ~/.claude/projects/<cwd with every
 * character outside A-Z, a-z, 0-9 turned into "-">/<session id>.jsonl. Resuming a
 * session whose file is gone (reinstall, cleaned ~/.claude) fails, so runs check first.
 */
export function sessionPath(cwd: string, sessionId: string, home = os.homedir()) {
  return path.join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
}

export function sessionExists(cwd: string, sessionId: string) {
  try {
    return fs.statSync(sessionPath(cwd, sessionId)).size > 0;
  } catch {
    return false;
  }
}
