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

function readLock(dir: string): Lock | null {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath(dir), "utf8")) as Lock;
    return lock.pid ? lock : null;
  } catch {
    return null;
  }
}

/** The live worker holding the folder, if any. */
export function folderWorker(dir: string): Lock | null {
  const lock = readLock(dir);
  return lock && alive(lock.pid) ? lock : null;
}

/** Create the lock file only if it doesn't exist yet (O_EXCL: two workers can't both win). */
function tryCreate(dir: string) {
  let fd: number | undefined;
  try {
    fd = fs.openSync(lockPath(dir), "wx");
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Take the folder for this process. False if another live worker has it. A lock
 * left by a dead worker (crash, SIGKILL) is removed and taken over.
 */
export function acquireWorkerLock(dir: string) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (tryCreate(dir)) return true;
      const held = readLock(dir);
      if (held?.pid === process.pid) return true;
      if (held && alive(held.pid)) return false;
      fs.rmSync(lockPath(dir), { force: true }); // stale (dead pid or unreadable): retry once
    }
  } catch (err) {
    console.error(`[worker] couldn't take the lock on ${dir}`, err);
  }
  return false;
}

export function releaseWorkerLock(dir: string) {
  if (readLock(dir)?.pid === process.pid) fs.rmSync(lockPath(dir), { force: true });
}
