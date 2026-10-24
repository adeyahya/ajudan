import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { CONFIG_DIR } from "@/lib/folders";
import { dataDir } from "@/lib/paths";
import type { VoiceSettings } from "@/lib/voice-settings";

/**
 * Text to speech on this Mac, for WhatsApp voice-note replies: OmniVoice (k2-fsa) in
 * its own Python environment (~/.ajudan/voice, `pnpm voice:setup`), served by
 * scripts/voice-server.py on 127.0.0.1. One server for every business window: the
 * first caller starts it (a lock file keeps two from doing so), it loads the model
 * once and exits after 20 idle minutes. Nothing leaves the laptop; no tokens.
 */

const run = promisify(execFile);
const FFMPEG = process.env.AJUDAN_FFMPEG ?? "ffmpeg";
export const VOICE_DIR = process.env.AJUDAN_VOICE_DIR ?? path.join(CONFIG_DIR, "voice");
const PYTHON = path.join(VOICE_DIR, ".venv", "bin", "python");
const INFO = path.join(VOICE_DIR, "server.json");
const LOCK = path.join(VOICE_DIR, "server.lock");
const SERVER = process.env.AJUDAN_VOICE_SERVER ?? path.join(process.cwd(), "scripts", "voice-server.py");
/** Loading the model from disk takes a while on first use. */
const START_TIMEOUT_MS = 5 * 60_000;
/** Longer than this, a message is cut at a sentence for the voice note (the text has it all). */
const MAX_SPOKEN = 600;

/** Set up (`pnpm voice:setup` finished). */
export function voiceAvailable() {
  return fs.existsSync(path.join(VOICE_DIR, ".ready")) && fs.existsSync(PYTHON);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function healthy(port: number) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

function readPort(): number | null {
  try {
    return (JSON.parse(fs.readFileSync(INFO, "utf8")) as { port: number }).port;
  } catch {
    return null;
  }
}

let starting: Promise<number> | undefined;

/** The running server's port, starting it if needed. */
async function serverPort(): Promise<number> {
  const port = readPort();
  if (port && (await healthy(port))) return port;
  starting ??= startServer().finally(() => (starting = undefined));
  return starting;
}

async function startServer(): Promise<number> {
  if (!voiceAvailable()) throw new Error("Voice isn't set up on this Mac. Run `pnpm voice:setup` in the Ajudan folder.");
  const deadline = Date.now() + START_TIMEOUT_MS;
  let mine = false;
  try {
    fs.closeSync(fs.openSync(LOCK, "wx"));
    mine = true;
  } catch {
    // Another window is starting it; a lock older than the start timeout is left over from a crash.
    if (Date.now() - fs.statSync(LOCK).mtimeMs > START_TIMEOUT_MS) {
      fs.rmSync(LOCK, { force: true });
      return startServer();
    }
  }
  try {
    if (mine) {
      fs.rmSync(INFO, { force: true });
      const log = fs.openSync(path.join(VOICE_DIR, "server.log"), "a");
      spawn(PYTHON, [SERVER, "--info", INFO], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: "1" } }).unref();
      fs.closeSync(log);
    }
    while (Date.now() < deadline) {
      const port = readPort();
      if (port && (await healthy(port))) return port;
      await sleep(1000);
    }
    throw new Error(`The voice didn't start in time (see ${path.join(VOICE_DIR, "server.log")}).`);
  } finally {
    if (mine) fs.rmSync(LOCK, { force: true });
  }
}

/**
 * Say `text` in the business's voice and save it as a WhatsApp voice note (OGG/Opus)
 * under work/voice/. Returns the folder-relative path.
 */
export async function speak(text: string, settings: VoiceSettings, language: string, signal?: AbortSignal): Promise<string> {
  const port = await serverPort();
  const rel = path.join("work", "voice", `${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString("hex")}.ogg`);
  const ogg = path.join(dataDir(), rel);
  fs.mkdirSync(path.dirname(ogg), { recursive: true });
  const wav = ogg.replace(/\.ogg$/, ".wav");
  const clone = settings.refAudio && settings.refText ? { ref_audio: path.join(dataDir(), settings.refAudio), ref_text: settings.refText } : { instruct: settings.instruct };
  const res = await fetch(`http://127.0.0.1:${port}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, out: wav, language, ...clone }),
    signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]),
  });
  const out = (await res.json()) as { seconds?: number; error?: string };
  if (!res.ok) throw new Error(`The voice failed: ${out.error ?? res.status}`);
  try {
    // WhatsApp voice notes: Opus in Ogg, mono, 48 kHz.
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", ogg]);
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return rel;
}

/**
 * A message as it should sound: no markdown, links, emoji or lists, cut at a sentence
 * when it's long (the written message still carries everything).
 */
export function speakable(text: string) {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>~|]/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s*\n+\s*/g, ". ")
    // "Laporan:. 3 pesanan" → "Laporan: 3 pesanan"; a label left without its link goes.
    .replace(/([:;,])\s*\.\s*/g, "$1 ")
    .replace(/[\s\p{L}]{0,30}:\s*$/u, "")
    .replace(/\.(\s*\.)+/g, ".")
    .replace(/\s+([.,!?:;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (plain.length <= MAX_SPOKEN) return plain;
  const cut = plain.slice(0, MAX_SPOKEN);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 100 ? cut.slice(0, end + 1) : cut;
}
