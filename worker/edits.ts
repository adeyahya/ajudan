/**
 * Renders Studio edits (src/lib/edits.ts) with ffmpeg: no Claude, so these jobs run
 * while the team rests. The result goes into the media library (media/) with a note on
 * what it was made from, so the team can use it next.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Edit } from "@/db/schema";
import { organize } from "@/lib/assets";
import { ASPECTS, AudioSpecSchema, VideoSpecSchema, videoLength, type AudioSpec, type VideoSpec } from "@/lib/edits";
import { logEvent } from "@/lib/events";
import type { JobPayloads } from "@/lib/jobs";
import { mediaInfo, newMediaPath } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { PausedError, runAbortController } from "./session";

const run = promisify(execFile);
const FFMPEG = process.env.AJUDAN_FFMPEG ?? "ffmpeg";
const FPS = 30;
const FADE = 0.6;

export async function renderEdit({ editId }: JobPayloads["render_edit"]) {
  const edit = db.select().from(schema.edits).where(eq(schema.edits.id, editId)).get();
  if (!edit) return;
  const set = (v: Partial<Edit>) => db.update(schema.edits).set({ ...v, updatedAt: new Date() }).where(eq(schema.edits.id, edit.id)).run();
  const ac = runAbortController();
  set({ status: "rendering", error: null });
  logEvent({ businessId: edit.businessId, type: "edit_rendering", message: `Rendering "${edit.title}" (${edit.kind} edit)`, data: { editId } });
  const dir = dataDir();
  const ext = edit.kind === "video" ? ".mp4" : `.${AudioSpecSchema.parse(edit.spec).format}`;
  const rel = newMediaPath(`${edit.title}${ext}`);
  const tmp = path.join(dir, "media", `.rendering-${edit.id}${ext}`);
  try {
    const { args, sources } =
      edit.kind === "video" ? await videoArgs(VideoSpecSchema.parse(edit.spec), dir) : audioArgs(AudioSpecSchema.parse(edit.spec), dir);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    await run(FFMPEG, ["-y", "-hide_banner", "-v", "error", ...args, tmp], { signal: ac.signal, maxBuffer: 10 * 1024 * 1024, timeout: 60 * 60_000 });
    fs.renameSync(tmp, path.join(dir, rel));
    const from = [...new Set(sources)].map((s) => path.basename(s)).join(", ");
    organize(edit.businessId, [rel], { title: edit.title, note: `Made in the Studio ${edit.kind} editor from ${from}.` }, ["studio-edit"]);
    set({ status: "done", output: rel });
    logEvent({ businessId: edit.businessId, type: "edit_rendered", message: `"${edit.title}" is ready in the library`, data: { editId, path: rel } });
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (ac.signal.aborted) {
      set({ status: "queued" });
      throw new PausedError();
    }
    const e = err as Error & { stderr?: string };
    const message = (e.stderr?.trim().split("\n").slice(-3).join(" ") || e.message).slice(0, 500);
    set({ status: "failed", error: message });
    logEvent({ businessId: edit.businessId, type: "edit_failed", message: `Couldn't render "${edit.title}": ${message}`, data: { editId } });
  }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size: the chosen aspect, or the first clip's own (long side at most 1920). */
async function frameSize(spec: VideoSpec, dir: string) {
  const a = ASPECTS[spec.aspect];
  if (a.w) return { w: a.w, h: a.h };
  const info = await mediaInfo(path.join(dir, spec.clips[0].file));
  const w = info.width ?? 1080;
  const h = info.height ?? 1920;
  const k = Math.min(1, 1920 / Math.max(w, h));
  return { w: even(w * k), h: even(h * k) };
}

async function videoArgs(spec: VideoSpec, dir: string) {
  const { w, h } = await frameSize(spec, dir);
  const total = videoLength(spec);
  const inputs: string[] = [];
  const filters: string[] = [];
  const pairs: string[] = [];
  let n = 0;
  for (const [i, c] of spec.clips.entries()) {
    const abs = path.join(dir, c.file);
    if (!fs.existsSync(abs)) throw new Error(`${c.file} is no longer in the library`);
    const dur = c.end - c.start;
    inputs.push("-ss", c.start.toFixed(3), "-t", dur.toFixed(3), "-i", abs);
    const v = n++;
    const fit =
      spec.fit === "crop"
        ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
        : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
    filters.push(`[${v}:v]${fit},setsar=1,fps=${FPS},format=yuv420p,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    const hasAudio = !c.muted && c.volume > 0 && (await mediaInfo(abs)).hasAudio;
    if (hasAudio) {
      filters.push(
        `[${v}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${c.volume},atrim=duration=${dur.toFixed(3)},apad=whole_dur=${dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
      );
    } else {
      inputs.push("-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
      filters.push(`[${n++}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
    pairs.push(`[v${i}][a${i}]`);
  }
  filters.push(`${pairs.join("")}concat=n=${spec.clips.length}:v=1:a=1[vc][ac]`);

  const fade = Math.min(FADE, total / 4);
  const vf = [spec.fadeIn && `fade=t=in:st=0:d=${fade}`, spec.fadeOut && `fade=t=out:st=${(total - fade).toFixed(3)}:d=${fade}`].filter(Boolean);
  const af = [spec.fadeIn && `afade=t=in:st=0:d=${fade}`, spec.fadeOut && `afade=t=out:st=${(total - fade).toFixed(3)}:d=${fade}`].filter(Boolean);
  filters.push(`[vc]${vf.length ? vf.join(",") : "null"}[vout]`);

  const sources = spec.clips.map((c) => c.file);
  if (spec.music) {
    const abs = path.join(dir, spec.music.file);
    if (!fs.existsSync(abs)) throw new Error(`${spec.music.file} is no longer in the library`);
    sources.push(spec.music.file);
    inputs.push("-stream_loop", "-1", "-ss", spec.music.start.toFixed(3), "-i", abs);
    const m = n++;
    const out = Math.min(1.5, total / 3);
    filters.push(
      `[${m}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${spec.music.volume},atrim=duration=${total.toFixed(3)},afade=t=out:st=${(total - out).toFixed(3)}:d=${out.toFixed(3)},asetpts=PTS-STARTPTS[mus]`,
    );
    filters.push(`[ac][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0${af.length ? `,${af.join(",")}` : ""}[aout]`);
  } else {
    filters.push(`[ac]${af.length ? af.join(",") : "anull"}[aout]`);
  }
  const args = [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-t",
    total.toFixed(3),
  ];
  return { args, sources };
}

function audioArgs(spec: AudioSpec, dir: string) {
  const abs = path.join(dir, spec.file);
  if (!fs.existsSync(abs)) throw new Error(`${spec.file} is no longer in the library`);
  const dur = spec.end - spec.start;
  const chain = ["aresample=48000"];
  if (spec.gainDb) chain.push(`volume=${spec.gainDb}dB`);
  if (spec.normalize) chain.push("loudnorm=I=-16:TP=-1.5:LRA=11", "aresample=48000");
  if (spec.fadeIn) chain.push(`afade=t=in:st=0:d=${Math.min(spec.fadeIn, dur / 2)}`);
  if (spec.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, dur - spec.fadeOut).toFixed(3)}:d=${Math.min(spec.fadeOut, dur / 2)}`);
  const codec =
    spec.format === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : spec.format === "wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
  return { args: ["-ss", spec.start.toFixed(3), "-t", dur.toFixed(3), "-i", abs, "-vn", "-af", chain.join(","), ...codec], sources: [spec.file] };
}
