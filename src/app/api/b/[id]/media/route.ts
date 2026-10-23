import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { t } from "@/lib/i18n";
import { findSameFile } from "@/lib/assets";
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
  const business = db.select({ id: schema.businesses.id, language: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  if (!business) return Response.json({ error: "Business not found" }, { status: 404 });
  const lang = business.language;

  const name = decodeURIComponent(req.headers.get("x-file-name") ?? "");
  if (!name || !MEDIA_TYPES[path.extname(name).toLowerCase()]) {
    return Response.json({ error: t(lang, "chat.err.unsupported") }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return Response.json({ error: t(lang, "chat.err.tooLarge") }, { status: 413 });
  }
  if (!req.body) return Response.json({ error: t(lang, "chat.err.empty") }, { status: 400 });

  const rel = newMediaPath(name);
  const abs = path.join(dataDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), fs.createWriteStream(abs));
  } catch (err) {
    fs.rmSync(abs, { force: true });
    return Response.json({ error: t(lang, "chat.err.upload", { error: (err as Error).message }) }, { status: 500 });
  }
  // The same file sent again (a photo re-sent in chat) reuses the one already in the library.
  const same = await findSameFile(abs, rel).catch(() => null);
  if (same) fs.rmSync(abs, { force: true });
  const out = same ?? rel;
  const info = await mediaInfo(path.join(dataDir(), out));
  return Response.json({ path: out, name, kind: mediaKind(out), info, label: describeMedia(out, info), existing: !!same });
}
