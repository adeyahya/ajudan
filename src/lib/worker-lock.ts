import fs from "node:fs";
import path from "node:path";

/**
 * One worker per business folder. The Ajudan app runs a worker per open window
 * (several businesses at once) and `pnpm dev` runs one too; this lock file keeps two
 * of them from working the same folder (double runs, requeued jobs, two WhatsApp syncs).
 */

type Lock = { pid: number; startedAt: string };

const lockPath = (dir: string) => path.join(dir, ".worker.lock");

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The live worker holding the folder, if any. */
export function folderWorker(dir: string): Lock | null {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath(dir), "utf8")) as Lock;
    return lock.pid && alive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

/** Take the folder for this process. False if another live worker has it. */
export function acquireWorkerLock(dir: string) {
  const held = folderWorker(dir);
  if (held && held.pid !== process.pid) return false;
  fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return true;
}

export function releaseWorkerLock(dir: string) {
  if (folderWorker(dir)?.pid === process.pid) fs.rmSync(lockPath(dir), { force: true });
}
