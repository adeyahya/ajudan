import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Speech to text, on this Mac: whisper.cpp (`brew install whisper-cpp`) with the
 * large-v3-turbo model in ~/.ajudan/models (shared by every business). Audio never
 * leaves the laptop. Used for WhatsApp voice notes from people on the team
 * (worker/humans.ts) and by teammates for footage and audio (transcribe_media).
 */

const run = promisify(execFile);
const WHISPER = process.env.AJUDAN_WHISPER ?? "whisper-cli";
const FFMPEG = process.env.AJUDAN_FFMPEG ?? "ffmpeg";
export const WHISPER_MODEL =
  process.env.AJUDAN_WHISPER_MODEL ?? path.join(os.homedir(), ".ajudan", "models", "ggml-large-v3-turbo-q5_0.bin");

export type Transcript = {
  text: string;
  language: string;
  /** Timed pieces (seconds), for captions. */
  segments: { start: number; end: number; text: string }[];
  /** Path of the .srt written next to the media (when asked). */
  srt?: string;
};

export function speechAvailable() {
  return fs.existsSync(WHISPER_MODEL);
}

/** "00:00:01,240" → 1.24 */
function ts(s: string) {
  const [h, m, rest] = s.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(",", "."));
}

const srtTime = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/**
 * Transcribe an audio or video file. `language` is a code like "id" or "en", or
 * "auto". With `srtNextTo`, writes captions as <file>.srt beside the media.
 */
export async function transcribe(abs: string, opts: { language?: string; srtNextTo?: boolean; signal?: AbortSignal } = {}): Promise<Transcript> {
  if (!speechAvailable()) throw new Error(`Speech recognition isn't set up: the model ${path.basename(WHISPER_MODEL)} is missing in ${path.dirname(WHISPER_MODEL)}.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-stt-"));
  try {
    // whisper.cpp wants 16 kHz mono WAV; WhatsApp voice notes are Opus in Ogg.
    const wav = path.join(tmp, "audio.wav");
    await run(FFMPEG, ["-y", "-v", "error", "-i", abs, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], {
      timeout: 120_000,
      signal: opts.signal,
    });
    const out = path.join(tmp, "out");
    const { stderr } = await run(
      WHISPER,
      ["-m", WHISPER_MODEL, "-f", wav, "-l", opts.language || "auto", "-osrt", "-otxt", "-of", out, "-np", "-t", String(Math.max(2, Math.min(8, os.cpus().length - 2)))],
      { timeout: 20 * 60_000, maxBuffer: 20 * 1024 * 1024, signal: opts.signal },
    );
    const language = /auto-detected language: (\w+)/.exec(stderr)?.[1] ?? opts.language ?? "auto";
    const srtText = fs.existsSync(`${out}.srt`) ? fs.readFileSync(`${out}.srt`, "utf8") : "";
    const segments = srtText
      .split(/\n\s*\n/)
      .map((block) => {
        const lines = block.trim().split("\n");
        const time = /(\d+:\d+:\d+,\d+) --> (\d+:\d+:\d+,\d+)/.exec(lines[1] ?? "");
        return time ? { start: ts(time[1]), end: ts(time[2]), text: lines.slice(2).join(" ").trim() } : null;
      })
      .filter((s): s is Transcript["segments"][number] => !!s && !!s.text && !/^\[.*\]$/.test(s.text));
    const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    const result: Transcript = { text, language, segments };
    if (opts.srtNextTo && segments.length) {
      const srt = abs.replace(/\.[^./]+$/, "") + ".srt";
      fs.writeFileSync(srt, segments.map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`).join("\n"));
      result.srt = srt;
    }
    return result;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
