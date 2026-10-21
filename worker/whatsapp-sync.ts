/**
 * Keeps the open business's WhatsApp in sync: while the folder is open and its
 * WhatsApp is linked, runs `wacli sync --follow` (which also carries out sends,
 * spaced a few seconds apart). Stopped when the folder is closed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { isLinked, syncStatusPath, unlink, unlinkRequestPath, whatsappDir } from "@/lib/whatsapp";

const WACLI = process.env.AJUDAN_WACLI_PATH ?? "wacli";
const CHECK_MS = 5_000;

let child: ChildProcess | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let dir: string | undefined;
let statusFile: string | undefined;

function writeStatus(s: { running: boolean; since?: string; error?: string }) {
  if (!statusFile) return;
  try {
    fs.writeFileSync(statusFile, JSON.stringify(s));
  } catch {
    // folder gone
  }
}

async function ensure() {
  if (!dir) return;
  // The owner pressed "Unlink" (the web app can't stop our sync process itself).
  const flag = unlinkRequestPath();
  if (fs.existsSync(flag)) {
    if (child) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
    }
    try {
      await unlink();
      console.log("[whatsapp] unlinked");
    } catch (err) {
      console.error("[whatsapp] unlink failed", err);
    }
    fs.rmSync(flag, { force: true });
    return;
  }
  if (child) return;
  if (!fs.existsSync(dir) || !(await isLinked())) return;
  const c = spawn(
    WACLI,
    [
      "--store",
      dir,
      "--events",
      "sync",
      "--follow",
      "--refresh-groups",
      "--refresh-contacts",
      "--presence-mode",
      "quiet",
      "--send-spacing",
      "2s-6s",
      "--max-db-size",
      "1GB",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child = c;
  let lastError: string | undefined;
  c.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      try {
        const ev = JSON.parse(line) as { event: string; data?: { message?: string } };
        if (ev.event === "error") lastError = ev.data?.message;
      } catch {
        // ignore
      }
    }
  });
  writeStatus({ running: true, since: new Date().toISOString() });
  console.log("[whatsapp] sync started");
  c.on("exit", (code) => {
    if (child === c) child = undefined;
    writeStatus({ running: false, error: code ? (lastError ?? `wacli sync exited with ${code}`) : undefined });
    console.log(`[whatsapp] sync stopped${code ? ` (${lastError ?? code})` : ""}`);
  });
}

/** Start syncing the open folder's WhatsApp (if linked); re-checks every 30s. */
export function startWhatsappSync() {
  stopWhatsappSync();
  dir = whatsappDir();
  statusFile = syncStatusPath();
  void ensure();
  timer = setInterval(() => void ensure(), CHECK_MS);
}

export function stopWhatsappSync() {
  clearInterval(timer);
  timer = undefined;
  if (child) {
    child.kill("SIGTERM");
    child = undefined;
  }
  writeStatus({ running: false });
  dir = undefined;
  statusFile = undefined;
}
