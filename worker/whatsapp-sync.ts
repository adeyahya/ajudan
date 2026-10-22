/**
 * Keeps the open business's WhatsApp in sync: while the folder is open and its
 * WhatsApp is linked, runs `wacli sync --follow` (which also carries out sends,
 * spaced a few seconds apart). Stopped when the folder is closed.
 *
 * The sync POSTs each live message to a webhook on 127.0.0.1 (signed with a secret made
 * per run), so the inbox reacts the moment someone writes instead of on its next poll.
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { isLinked, syncStatusPath, unlink, unlinkRequestPath, whatsappDir } from "@/lib/whatsapp";

const WACLI = process.env.AJUDAN_WACLI_PATH ?? "wacli";
const CHECK_MS = 5_000;

let child: ChildProcess | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let dir: string | undefined;
let statusFile: string | undefined;

let hook: { server: http.Server; url: string; secret: string } | undefined;
let onMessage: () => void = () => {};

/** Called (unordered, maybe in bursts) whenever a message arrives on the business's WhatsApp. */
export function onIncomingMessage(fn: () => void) {
  onMessage = fn;
}

function signedBy(secret: string, body: Buffer, header: string | string[] | undefined) {
  const got = String(header ?? "").replace(/^sha256=/, "");
  const want = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

let starting: Promise<NonNullable<typeof hook>> | undefined;

function ensureHook() {
  if (hook) return Promise.resolve(hook);
  starting ??= startHook().finally(() => (starting = undefined));
  return starting;
}

let heard = false;
let warned = false;

async function startHook() {
  const secret = crypto.randomBytes(24).toString("hex");
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size < 1_000_000) chunks.push(c);
    });
    req.on("end", () => {
      res.end();
      if (req.method !== "POST") return;
      if (!signedBy(secret, Buffer.concat(chunks), req.headers["x-wacli-signature"])) {
        if (!warned) console.warn("[whatsapp] webhook call with a bad signature ignored");
        warned = true;
        return;
      }
      if (!heard) console.log("[whatsapp] webhook works: new messages are picked up right away");
      heard = true;
      onMessage();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as { port: number };
  hook = { server, url: `http://127.0.0.1:${port}/message`, secret };
  return hook;
}

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
  if (child || paused) return;
  if (!fs.existsSync(dir) || !(await isLinked())) return;
  const h = await ensureHook().catch((err) => {
    console.error("[whatsapp] no webhook, polling only", err);
    return undefined;
  });
  if (child || paused || !dir) return;
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
      ...(h ? ["--webhook", h.url, "--webhook-allow-private", "--webhook-secret", h.secret] : []),
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

let paused = 0;

/**
 * Run a wacli command that needs the store lock the sync holds (e.g. creating a
 * group). Stops the sync, runs `fn`, and lets the next check restart it.
 */
export async function withSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  paused++;
  try {
    const c = child;
    if (c) {
      const exited = new Promise((r) => c.once("exit", r));
      c.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    return await fn();
  } finally {
    paused--;
    if (!paused) void ensure();
  }
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
  hook?.server.close();
  hook = undefined;
  dir = undefined;
  statusFile = undefined;
}
