import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { isFresh, metaRows, relInFolder, saveMeta, stampOf } from "@/lib/file-meta";
import { slugify } from "@/lib/folders";
import { mediaKind, type MediaKind } from "@/lib/media-types";
import { currentDataDir, dataDir } from "@/lib/paths";

/**
 * The business's media library: footage, photos and audio the owner drops into a chat,
 * stored in <folder>/media/. Tasks reference files by their path relative to the
 * folder ("media/2026-10-22-unboxing-a1b2c3.mp4").
 */

const run = promisify(execFile);
const FFPROBE = process.env.AJUDAN_FFPROBE ?? "ffprobe";
const FFMPEG = process.env.AJUDAN_FFMPEG ?? "ffmpeg";

export { MEDIA_TYPES, mediaKind, type MediaKind } from "@/lib/media-types";

export const mediaDir = (dir = dataDir()) => path.join(dir, "media");

/** A new, unique path under media/ for an uploaded file name. */
export function newMediaPath(originalName: string) {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
  const base = slugify(path.basename(originalName, path.extname(originalName))).slice(0, 40) || "file";
  return path.join("media", `${new Date().toISOString().slice(0, 10)}-${base}-${nanoid(6)}${ext}`);
}

/** Folder-relative paths that may be served to the browser or attached to work. */
export function isServablePath(rel: string) {
  const clean = path.normalize(rel);
  return !clean.startsWith("..") && !path.isAbsolute(clean) && (clean.startsWith("work/") || clean.startsWith("media/"));
}

export type MediaInfo = {
  kind: MediaKind;
  bytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
};

/** ffprobe results for files outside the business folder (inside it, file_meta keeps them). */
const probed = new Map<string, { stamp: string; info: MediaInfo }>();
const MAX_PROBED = 2000;

/**
 * Size, and for video/audio/images duration, dimensions, fps and audio (ffprobe). The
 * Studio editors and list_media describe the same library over and over, so results are
 * kept while the file's size and mtime stay the same (src/lib/file-meta.ts).
 */
export async function mediaInfo(abs: string): Promise<MediaInfo> {
  const kind = mediaKind(abs);
  const st = fs.statSync(abs);
  const info: MediaInfo = { kind, bytes: st.size };
  if (kind === "file") return info;
  const stamp = stampOf(st);
  const dir = currentDataDir();
  const rel = dir ? relInFolder(dir, abs) : null;
  if (dir && rel) {
    const row = metaRows(dir, [rel]).get(rel);
    if (isFresh(row, stamp) && row!.probe) return { ...info, ...row!.probe };
    await probe(abs, kind, info);
    const { width, height, durationSec, fps, hasAudio } = info;
    saveMeta(dir, [{ path: rel, ...stamp, title: row?.title ?? null, probe: { width, height, durationSec, fps, hasAudio } }]);
    return info;
  }
  const key = `${stamp.bytes}:${stamp.mtimeMs}`;
  const hit = probed.get(abs);
  if (hit?.stamp === key) return { ...hit.info };
  await probe(abs, kind, info);
  if (probed.size >= MAX_PROBED) probed.delete(probed.keys().next().value!);
  probed.set(abs, { stamp: key, info: { ...info } });
  return info;
}

async function probe(abs: string, kind: MediaKind, info: MediaInfo) {
  try {
    const { stdout } = await run(
      FFPROBE,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", abs],
      { timeout: 20_000 },
    );
    const j = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
    };
    const v = j.streams?.find((s) => s.codec_type === "video");
    // (MP3 cover art shows up as a video stream: ignore it for audio.)
    if (v?.width && v.height && kind !== "audio") {
      // Phone footage is often stored landscape with a rotation flag.
      const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
      [info.width, info.height] = rot === 90 || rot === 270 ? [v.height, v.width] : [v.width, v.height];
    }
    if (kind !== "image") {
      const d = Number(j.format?.duration);
      if (Number.isFinite(d)) info.durationSec = Math.round(d * 100) / 100;
      const [n, den] = (v?.avg_frame_rate ?? "").split("/").map(Number);
      if (n && den) info.fps = Math.round((n / den) * 100) / 100;
      info.hasAudio = !!j.streams?.some((s) => s.codec_type === "audio");
    }
  } catch {
    // Unknown format: size is still useful.
  }
}

export function describeMedia(rel: string, info: MediaInfo) {
  const parts: string[] = [info.kind];
  if (info.width && info.height) parts.push(`${info.width}×${info.height}`);
  if (info.durationSec !== undefined) parts.push(`${info.durationSec}s`);
  if (info.fps) parts.push(`${info.fps} fps`);
  if (info.kind === "video") parts.push(info.hasAudio ? "with sound" : "no sound");
  parts.push(info.bytes > 1e6 ? `${(info.bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(info.bytes / 1e3)} KB`);
  return `${rel} (${parts.join(", ")})`;
}

/**
 * A small JPG preview (`width` wide) of an image or of a video's first moments, written to
 * `out`. Throws when ffmpeg can't read the file.
 */
export async function makeThumbnail(abs: string, out: string, width = 360) {
  const scale = `scale='min(${width},iw)':-2`;
  const args = (seek: boolean) => ["-y", "-v", "error", ...(seek ? ["-ss", "0.5"] : []), "-i", abs, "-frames:v", "1", "-vf", scale, "-q:v", "5", out];
  if (mediaKind(abs) === "video") {
    // Clips shorter than half a second have no frame there: take the first one.
    await run(FFMPEG, args(true), { timeout: 30_000 }).catch(() => run(FFMPEG, args(false), { timeout: 30_000 }));
  } else {
    await run(FFMPEG, args(false), { timeout: 30_000 });
  }
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error(`No thumbnail for ${abs}`);
}

/**
 * Still frames from a video, evenly spread (or at given seconds), as JPGs so a
 * teammate can look at footage with Read.
 */
export async function extractFrames(abs: string, outDir: string, opts: { count?: number; at?: number[]; width?: number }) {
  const info = await mediaInfo(abs);
  const duration = info.durationSec ?? 0;
  const count = Math.min(opts.count ?? 6, 24);
  const times = opts.at?.length
    ? opts.at.slice(0, 24)
    : Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
  fs.mkdirSync(outDir, { recursive: true });
  const base = slugify(path.basename(abs, path.extname(abs))).slice(0, 30);
  const out: { file: string; atSec: number }[] = [];
  for (const t of times) {
    const at = Math.max(0, Math.min(t, Math.max(0, duration - 0.05)));
    const file = path.join(outDir, `${base}-${at.toFixed(2)}s.jpg`);
    await run(
      FFMPEG,
      ["-y", "-v", "error", "-ss", String(at), "-i", abs, "-frames:v", "1", "-vf", `scale=${opts.width ?? 540}:-2`, "-q:v", "4", file],
      { timeout: 30_000 },
    );
    out.push({ file, atSec: Math.round(at * 100) / 100 });
  }
  return out;
}

/** Hard-link a file (copy across disks) so big footage isn't duplicated on disk. */
export function linkFile(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) {
    if (fs.statSync(to).ino === fs.statSync(from).ino) return;
    fs.rmSync(to);
  }
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
}

/**
 * Make folder files ("media/…", "work/…") readable in a teammate's working folder at
 * the same relative path. Returns the paths that exist.
 */
export function linkIntoWorkspace(files: string[], cwd: string, dir = dataDir()) {
  const linked: string[] = [];
  for (const rel of files) {
    if (!isServablePath(rel)) continue;
    const from = path.join(dir, rel);
    if (!fs.existsSync(from)) continue;
    linkFile(from, path.join(cwd, rel));
    linked.push(rel);
  }
  return linked;
}
