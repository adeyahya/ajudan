import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { MEDIA_TYPES, describeMedia, mediaInfo, mediaKind, newMediaPath } from "@/lib/media";
import { dataDir } from "@/lib/paths";

const MAX_BYTES = 4 * 1024 ** 3; // 4 GB per file

/**
 * Upload one file into the business's media library (<folder>/media/). The body is the
 * raw file, streamed to disk (videos can be large); the name comes in X-File-Name.
 * Returns the folder-relative path that a chat message then attaches.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/b/[id]/media">) {
  const { id } = await ctx.params;
  const business = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  if (!business) return Response.json({ error: "Business not found" }, { status: 404 });

  const name = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  if (!name || !MEDIA_TYPES[path.extname(name).toLowerCase()]) {
    return Response.json(
      { error: `Unsupported file type. Use video (mp4, mov, webm), images, audio or PDF.` },
      { status: 415 },
    );
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return Response.json({ error: "File is larger than 4 GB" }, { status: 413 });
  }
  if (!req.body) return Response.json({ error: "Empty file" }, { status: 400 });

  const rel = newMediaPath(name);
  const abs = path.join(dataDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), fs.createWriteStream(abs));
  } catch (err) {
    fs.rmSync(abs, { force: true });
    return Response.json({ error: `Upload failed: ${(err as Error).message}` }, { status: 500 });
  }
  const info = await mediaInfo(abs);
  return Response.json({ path: rel, name, kind: mediaKind(rel), info, label: describeMedia(rel, info) });
}
