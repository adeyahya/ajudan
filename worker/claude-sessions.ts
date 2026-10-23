import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where Claude Code keeps a session's transcript: ~/.claude/projects/<cwd with every
 * character outside A-Z, a-z, 0-9 turned into "-">/<session id>.jsonl. Resuming a
 * session whose file is gone (reinstall, cleaned ~/.claude) fails, so runs check first.
 */
export function sessionPath(cwd: string, sessionId: string, home = os.homedir()) {
  return sessionIn(path.join(home, ".claude"), cwd, sessionId);
}

const sessionIn = (configDir: string, cwd: string, sessionId: string) => path.join(configDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);

/** `configDir`: Claude Code's config folder for the business's backend (claudeConfigDir). */
export function sessionExists(cwd: string, sessionId: string, configDir = path.join(os.homedir(), ".claude")) {
  try {
    return fs.statSync(sessionIn(configDir, cwd, sessionId)).size > 0;
  } catch {
    return false;
  }
}
