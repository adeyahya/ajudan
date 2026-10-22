import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { dataDir } from "@/lib/paths";

/**
 * The business's WhatsApp, through wacli (https://wacli.sh): a linked WhatsApp Web
 * device whose session and local message store live in <folder>/whatsapp. Teammates
 * only ever see the chats the owner allows (businesses.whatsappChats).
 *
 * wacli uses the unofficial WhatsApp Web protocol: link the business number, keep
 * volume human-sized, and expect WhatsApp may limit accounts that look like spam.
 */

const run = promisify(execFile);
const WACLI = process.env.AJUDAN_WACLI_PATH ?? "wacli";

export function whatsappDir() {
  return path.join(dataDir(), "whatsapp");
}

/** Run a one-shot wacli command with JSON output. Reads pass readOnly. */
export async function wacli<T = unknown>(
  args: string[],
  { readOnly = false, timeoutMs = 60_000 }: { readOnly?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const dir = whatsappDir();
  fs.mkdirSync(dir, { recursive: true });
  const full = ["--json", "--store", dir, ...(readOnly ? ["--read-only"] : []), "--lock-wait", "20s", ...args];
  let stdout: string;
  try {
    ({ stdout } = await run(WACLI, full, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }));
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: string; message: string };
    if (e.code === "ENOENT") throw new Error("wacli is not installed. Install it with: brew install openclaw/tap/wacli");
    stdout = e.stdout ?? "";
    if (!stdout.trim()) throw new Error(lastError(e.stderr) ?? e.message);
  }
  const env = JSON.parse(stdout) as { success: boolean; data: T; error: unknown };
  if (!env.success) throw new Error(typeof env.error === "string" ? env.error : JSON.stringify(env.error));
  return env.data;
}

function lastError(stderr?: string) {
  const line = (stderr ?? "").trim().split("\n").at(-1);
  if (!line) return undefined;
  try {
    const ev = JSON.parse(line) as { data?: { message?: string } };
    return ev.data?.message ?? line;
  } catch {
    return line;
  }
}

// ---- shapes (wacli 0.22 JSON) ----

export type WaGroup = { JID: string; Name: string; IsParent: boolean; LinkedParentJID: string; LeftAt: string };
export type WaMessage = {
  ChatJID: string;
  ChatName: string;
  MsgID: string;
  SenderName: string;
  SenderJID: string;
  Timestamp: string;
  FromMe: boolean;
  Text: string;
  DisplayText: string;
  MediaType: string;
  MediaCaption: string;
  Filename: string;
  MimeType?: string;
  ReactionToID?: string;
  ReactionEmoji?: string;
};

/** A real message: not an emoji reaction, and has text or media. */
export function isRealMessage(m: WaMessage) {
  if (m.ReactionToID || m.ReactionEmoji) return false;
  const text = (m.Text || m.MediaCaption || m.DisplayText || "").trim();
  return !!m.MediaType || (!!text && text !== "(message)");
}

export async function isLinked() {
  try {
    const s = await wacli<{ authenticated: boolean }>(["auth", "status"], { readOnly: true, timeoutMs: 15_000 });
    return !!s?.authenticated;
  } catch {
    return false;
  }
}

/** Groups and communities this WhatsApp is in (from the local store; sync refreshes it). */
export async function listGroups(): Promise<WaGroup[]> {
  const groups = (await wacli<WaGroup[] | null>(["groups", "list", "--limit", "500"], { readOnly: true })) ?? [];
  return groups.filter((g) => !g.LeftAt || g.LeftAt.startsWith("0001"));
}

export async function listMessages(chatJid: string, opts: { limit?: number; after?: string } = {}) {
  const args = ["messages", "list", "--chat", chatJid, "--limit", String(opts.limit ?? 30)];
  if (opts.after) args.push("--after", opts.after);
  const d = await wacli<{ messages: WaMessage[] | null }>(args, { readOnly: true });
  return d.messages ?? [];
}

export async function searchMessages(query: string, chatJid?: string, limit = 30) {
  const args = ["messages", "search", query, "--limit", String(limit)];
  if (chatJid) args.push("--chat", chatJid);
  const d = await wacli<{ messages: WaMessage[] | null } | WaMessage[] | null>(args, { readOnly: true });
  return (Array.isArray(d) ? d : d?.messages) ?? [];
}

export type WaContact = { jid: string; name: string; phone: string; alias?: string; system_name?: string };

/** Contacts on the business's WhatsApp whose name or number matches (local store). */
export async function searchContacts(query: string, limit = 10) {
  const d = await wacli<WaContact[] | null>(["contacts", "search", query, "--limit", String(limit)], { readOnly: true });
  return (d ?? []).filter((c) => c.jid?.endsWith("@s.whatsapp.net"));
}

export async function sendText(chatJid: string, message: string) {
  return wacli(["send", "text", "--to", chatJid, "--message", message], { timeoutMs: 120_000 });
}

export async function sendFile(chatJid: string, file: string, caption?: string) {
  return wacli(["send", "file", "--to", chatJid, "--file", file, ...(caption ? ["--caption", caption] : [])], {
    timeoutMs: 180_000,
  });
}

/** Create a group on the business's WhatsApp. Needs the store lock (see worker withSyncPaused). */
export async function createGroup(name: string, opts: { description?: string; announceOnly?: boolean } = {}) {
  const g = await wacli<{ JID: string; Name: string }>(
    ["groups", "create", "--name", name, ...(opts.announceOnly ? ["--announce-only"] : [])],
    { timeoutMs: 120_000 },
  );
  if (opts.description) {
    await wacli(["groups", "description", "--jid", g.JID, "--text", opts.description], { timeoutMs: 60_000 });
  }
  const invite = await wacli<{ link: string }>(["groups", "invite", "link", "get", "--jid", g.JID], { timeoutMs: 60_000 });
  return { jid: g.JID, name: g.Name, inviteLink: invite.link };
}

/** Rename / describe / admins-only a group. Needs the store lock (see worker withSyncPaused). */
export async function updateGroup(jid: string, opts: { name?: string; description?: string; adminsOnly?: boolean }) {
  if (opts.name) await wacli(["groups", "rename", "--jid", jid, "--name", opts.name]);
  if (opts.description !== undefined) await wacli(["groups", "description", "--jid", jid, "--text", opts.description]);
  if (opts.adminsOnly !== undefined) await wacli(["groups", "announce-only", "--jid", jid, opts.adminsOnly ? "--on" : "--off"]);
}

export async function inviteLink(jid: string) {
  return (await wacli<{ link: string }>(["groups", "invite", "link", "get", "--jid", jid])).link;
}

/** Whether a number (digits with country code) has WhatsApp; undefined when it can't be checked. */
export async function isOnWhatsapp(phone: string): Promise<boolean | undefined> {
  try {
    const d = await wacli<{ registered?: boolean }[] | { registered?: boolean }>(["contacts", "check", `+${phone}`], { timeoutMs: 30_000 });
    return (Array.isArray(d) ? d[0] : d)?.registered;
  } catch {
    return undefined;
  }
}

/** Download a message's photo/video/file to outPath (works while sync --follow runs). */
export async function downloadMedia(chatJid: string, msgId: string, outPath: string) {
  const d = await wacli<{ path: string; bytes: number; mime_type?: string }>(
    ["media", "download", "--chat", chatJid, "--id", msgId, "--output", outPath],
    { timeoutMs: 300_000 },
  );
  return d;
}

export async function unlink() {
  return wacli(["auth", "logout"], { timeoutMs: 30_000 });
}

/** "[22 Okt 09:14] Rina: Ada stok gantungan nama?" */
export function formatMessage(m: WaMessage) {
  const when = new Date(m.Timestamp);
  const ts = Number.isNaN(when.getTime()) ? m.Timestamp : when.toISOString().slice(0, 16).replace("T", " ");
  const who = m.FromMe ? "Business (you)" : m.SenderName || m.SenderJID.split("@")[0];
  const media = m.MediaType ? ` [${m.MediaType}${m.Filename ? `: ${m.Filename}` : ""}]` : "";
  const text = m.DisplayText || m.Text || m.MediaCaption || "";
  return `[${ts}] ${who}:${media} ${text}`.trim();
}

// ---- linking (owner scans a QR code) ----

type LinkState = { state: "idle" } | { state: "starting" } | { state: "qr"; code: string } | { state: "linked" } | { state: "error"; message: string };

declare global {
  var __ajudanWaLinks: Map<string, { child: ChildProcess; state: LinkState }> | undefined;
}
const links = (globalThis.__ajudanWaLinks ??= new Map());

/**
 * Start pairing: runs `wacli auth` and keeps the newest QR code. The owner scans it in
 * WhatsApp → Settings → Linked devices → Link a device. wacli then does a first sync
 * and exits; the worker takes over syncing.
 */
export function startLink() {
  const dir = whatsappDir();
  const existing = links.get(dir);
  if (existing && existing.child.exitCode === null) return;
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(
    WACLI,
    ["--store", dir, "--events", "auth", "--qr-format", "text", "--idle-exit", "45s", "--history-days", "30"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const entry = { child, state: { state: "idle" } as LinkState };
  links.set(dir, entry);
  let buf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const ev = JSON.parse(line) as { event: string; data?: { code?: string; message?: string } };
        if (ev.event === "qr_code" && ev.data?.code) entry.state = { state: "qr", code: ev.data.code };
        else if (ev.event === "error" && ev.data?.message) entry.state = { state: "error", message: ev.data.message };
        else if (/pair|auth(enticated|_success)|connected|logged_in/i.test(ev.event)) entry.state = { state: "linked" };
      } catch {
        // not an event line
      }
    }
  });
  child.on("exit", () => {
    if (entry.state.state === "qr") entry.state = { state: "idle" };
  });
}

export async function linkState(): Promise<LinkState> {
  const entry = links.get(whatsappDir());
  if (entry?.state.state === "qr" && entry.child.exitCode === null) return entry.state;
  if (entry && entry.state.state === "idle" && entry.child.exitCode === null) return { state: "starting" };
  if (await isLinked()) return { state: "linked" };
  if (entry?.state.state === "error") return entry.state;
  return { state: "idle" };
}

export function cancelLink() {
  const entry = links.get(whatsappDir());
  if (entry && entry.child.exitCode === null) entry.child.kill("SIGTERM");
  links.delete(whatsappDir());
}

/** The web app asks the worker to unlink by creating this file. */
export function unlinkRequestPath() {
  return path.join(whatsappDir(), "ajudan-unlink-requested");
}

/** Written by the worker's sync process so the UI can show it. */
export function syncStatusPath() {
  return path.join(whatsappDir(), "ajudan-sync.json");
}

export function readSyncStatus(): { running: boolean; since?: string; error?: string } {
  try {
    return JSON.parse(fs.readFileSync(syncStatusPath(), "utf8"));
  } catch {
    return { running: false };
  }
}
