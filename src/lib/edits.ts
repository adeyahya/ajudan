import { z } from "zod";

/**
 * Studio edits: what the owner builds in the video and audio editors, as a plain edit
 * decision list. The worker renders it with ffmpeg (worker/edits.ts), never Claude, so
 * it runs while the team rests. Safe to import in client components.
 */

const mediaPath = z.string().regex(/^media\/[^/\\]+$/, "Pick a file from the library");
const seconds = z.number().min(0).max(6 * 3600);

export const ASPECTS = {
  source: { label: "Like the first clip", w: 0, h: 0 },
  "9:16": { label: "9:16 Reels / TikTok / Stories", w: 1080, h: 1920 },
  "4:5": { label: "4:5 Instagram feed", w: 1080, h: 1350 },
  "1:1": { label: "1:1 Square", w: 1080, h: 1080 },
  "16:9": { label: "16:9 YouTube / landscape", w: 1920, h: 1080 },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const VideoSpecSchema = z.object({
  aspect: z.enum(Object.keys(ASPECTS) as [Aspect, ...Aspect[]]).default("source"),
  /** crop: fill the frame (edges cut off); pad: fit inside with bars. */
  fit: z.enum(["crop", "pad"]).default("crop"),
  clips: z
    .array(
      z
        .object({
          file: mediaPath,
          start: seconds,
          end: seconds,
          muted: z.boolean().default(false),
          /** 0–2 (1 = as recorded). */
          volume: z.number().min(0).max(2).default(1),
        })
        .refine((c) => c.end - c.start >= 0.2, "A clip must be at least 0.2 s long"),
    )
    .min(1, "Add at least one clip")
    .max(60),
  music: z
    .object({
      file: mediaPath,
      /** Where in the song to start. */
      start: seconds.default(0),
      volume: z.number().min(0).max(1.5).default(0.35),
    })
    .nullable()
    .default(null),
  fadeIn: z.boolean().default(false),
  fadeOut: z.boolean().default(true),
});
export type VideoSpec = z.infer<typeof VideoSpecSchema>;

export const AUDIO_FORMATS = { m4a: "M4A (AAC)", mp3: "MP3", wav: "WAV" } as const;

export const AudioSpecSchema = z
  .object({
    /** An audio file, or a video to take the sound from. */
    file: mediaPath,
    start: seconds,
    end: seconds,
    gainDb: z.number().min(-24).max(24).default(0),
    fadeIn: z.number().min(0).max(30).default(0),
    fadeOut: z.number().min(0).max(30).default(0),
    /** Even out loudness to a standard level (EBU R128, −16 LUFS: good for social and voice). */
    normalize: z.boolean().default(false),
    format: z.enum(Object.keys(AUDIO_FORMATS) as [keyof typeof AUDIO_FORMATS, ...(keyof typeof AUDIO_FORMATS)[]]).default("m4a"),
  })
  .refine((s) => s.end - s.start >= 0.2, "The selection must be at least 0.2 s long");
export type AudioSpec = z.infer<typeof AudioSpecSchema>;

export function videoLength(spec: Pick<VideoSpec, "clips">) {
  return spec.clips.reduce((t, c) => t + Math.max(0, c.end - c.start), 0);
}

export function formatTime(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
