import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stampOf } from "@/lib/file-meta";
import { makeThumbnail } from "@/lib/media";
import { mediaKind } from "@/lib/media-types";

/**
 * Small previews for gallery tiles (Files, the Studio library, image strips), so a grid
 * of photos and videos doesn't load every original. Kept in <folder>/.cache/thumbs/,
 * named by the file's path, size and mtime: a changed file gets a new one. Made on first
 * request (GET /api/b/[id]/thumb/…), a few at a time.
 */

export const thumbsDir = (dir: string) => path.join(dir, ".cache", "thumbs");

const MAX_AT_ONCE = 3;
let active = 0;
const waiting: (() => void)[] = [];
const making = new Map<string, Promise<string | null>>();

async function slot<T>(fn: () => Promise<T>) {
  if (active >= MAX_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Only raster images and videos get one (SVGs are already small; audio has no picture). */
export const hasThumbnail = (rel: string) => (mediaKind(rel) === "image" && !/\.svg$/i.test(rel)) || mediaKind(rel) === "video";

/**
 * The thumbnail for `abs` (the file `rel` in folder `dir`), made if needed, or null when
 * ffmpeg can't read it. Concurrent requests for the same file share one ffmpeg run.
 */
export function thumbnailFor(dir: string, rel: string, abs: string): Promise<string | null> {
  const { bytes, mtimeMs } = stampOf(fs.statSync(abs));
  const key = createHash("sha1").update(`${rel}\0${bytes}\0${mtimeMs}`).digest("hex");
  const out = path.join(thumbsDir(dir), `${key}.jpg`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  let job = making.get(key);
  if (!job) {
    job = slot(async () => {
      fs.mkdirSync(thumbsDir(dir), { recursive: true });
      // Written aside and renamed, so a half-written file is never served.
      const tmp = `${out}.${process.pid}.tmp.jpg`;
      try {
        await makeThumbnail(abs, tmp);
        fs.renameSync(tmp, out);
        return out;
      } catch {
        fs.rmSync(tmp, { force: true });
        return null;
      }
    }).finally(() => making.delete(key));
    making.set(key, job);
  }
  return job;
}
