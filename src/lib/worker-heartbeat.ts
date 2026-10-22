import fs from "node:fs";
import path from "node:path";

/**
 * The worker's pulse: `<folder>/.worker-heartbeat.json`, rewritten every
 * HEARTBEAT_MS while it works the folder. The Health page reads it to say whether
 * the worker is alive and how busy it is. Separate from `.worker.lock` (which must
 * never be rewritten: it's the mutex) and written atomically (temp file + rename),
 * so a reader never sees half a file.
 */

export const HEARTBEAT_MS = 15_000;
/** A heartbeat older than this means the worker is hung or gone. */
export const HEARTBEAT_STALE_MS = HEARTBEAT_MS * 3;

export type Heartbeat = {
  pid: number;
  /** When this worker process started working the folder. */
  startedAt: string;
  /** When the file was last written. */
  at: string;
  /** Jobs in flight per lane (src/lib/jobs.ts). */
  running: { owner: number; team: number };
  concurrency: { owner: number; team: number };
};

export const heartbeatPath = (dir: string) => path.join(dir, ".worker-heartbeat.json");

export function writeHeartbeat(dir: string, hb: Omit<Heartbeat, "at">) {
  const file = heartbeatPath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...hb, at: new Date().toISOString() } satisfies Heartbeat));
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    console.error("[worker] couldn't write the heartbeat", err);
  }
}

export function removeHeartbeat(dir: string) {
  try {
    const hb = readHeartbeat(dir);
    if (hb?.pid === process.pid) fs.rmSync(heartbeatPath(dir), { force: true });
  } catch {
    // nothing to clean
  }
}

export function readHeartbeat(dir: string): Heartbeat | null {
  try {
    const hb = JSON.parse(fs.readFileSync(heartbeatPath(dir), "utf8")) as Heartbeat;
    return hb && typeof hb.pid === "number" && typeof hb.at === "string" ? hb : null;
  } catch {
    return null;
  }
}

/** Age of the heartbeat in ms; null without one. */
export function heartbeatAge(hb: Heartbeat | null, now = Date.now()) {
  if (!hb) return null;
  const at = Date.parse(hb.at);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

/** True while the heartbeat is fresh. Pure (no pid check) so it can be tested. */
export function heartbeatFresh(hb: Heartbeat | null, now = Date.now()) {
  const age = heartbeatAge(hb, now);
  return age !== null && age <= HEARTBEAT_STALE_MS;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type WorkerHealth = { status: "running" | "stale" | "stopped"; heartbeat: Heartbeat | null; ageMs: number | null };

/**
 * What the Health page shows: "running" (fresh heartbeat from a live process),
 * "stale" (the process is alive but hasn't written in a while: probably hung) or
 * "stopped" (no heartbeat, or its process is gone).
 */
export function workerHealth(dir: string, now = Date.now()): WorkerHealth {
  const hb = readHeartbeat(dir);
  const ageMs = heartbeatAge(hb, now);
  if (!hb || !alive(hb.pid)) return { status: "stopped", heartbeat: hb, ageMs };
  return { status: heartbeatFresh(hb, now) ? "running" : "stale", heartbeat: hb, ageMs };
}
