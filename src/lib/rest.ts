import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "@/lib/folders";

/**
 * "The team is resting": Claude's usage limit is used up. Every business on this Mac
 * shares the one Claude login, so the state lives next to the folder config
 * (~/.ajudan/rest.json), not in a business database. While it holds, workers leave AI
 * jobs queued instead of failing them; the office shows the team asleep and the owner
 * can still work things that cost no tokens (the Customer Desk, approvals, planning).
 */

const REST_PATH = path.join(CONFIG_DIR, "rest.json");
/** When Claude doesn't say when the limit resets, try again after this long. */
const RETRY_MS = 15 * 60_000;

export type RestState = { since: number; until: number; known: boolean };

/** Thrown by runAgent when the run stopped because the usage limit is used up. */
export class UsageLimitError extends Error {
  constructor(readonly resetsAt?: number) {
    super(`Claude usage limit reached${resetsAt ? `; resets ${new Date(resetsAt).toLocaleString()}` : ""}`);
  }
}

/** The current rest, or null once it has passed. */
export function readRest(now = Date.now()): RestState | null {
  try {
    const r = JSON.parse(fs.readFileSync(REST_PATH, "utf8")) as RestState;
    return typeof r.until === "number" && r.until > now ? r : null;
  } catch {
    return null;
  }
}

/** Start (or extend) a rest. Returns the new state and whether it just began. */
export function startRest(resetsAt?: number): { rest: RestState; began: boolean } {
  const now = Date.now();
  const prev = readRest(now);
  const until = resetsAt && resetsAt > now ? resetsAt : now + RETRY_MS;
  const rest: RestState = { since: prev?.since ?? now, until: Math.max(until, prev?.until ?? 0), known: Boolean(resetsAt) || Boolean(prev?.known) };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${REST_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rest));
  fs.renameSync(tmp, REST_PATH);
  return { rest, began: !prev };
}

export function clearRest() {
  fs.rmSync(REST_PATH, { force: true });
}

/** Claude reports reset times in epoch seconds; accept milliseconds too. */
export function toMs(t: number | undefined) {
  if (!t || !Number.isFinite(t)) return undefined;
  return t < 1e12 ? t * 1000 : t;
}
