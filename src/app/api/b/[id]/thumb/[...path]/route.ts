import fs from "node:fs";
import { Readable } from "node:stream";
import { resolveBrowsable } from "@/lib/browse";
import { currentDataDir } from "@/lib/paths";
import { hasThumbnail, thumbnailFor } from "@/lib/thumbs";

/**
 * A small JPG preview of an image or video the Files tab may show (src/lib/thumbs.ts).
 * Anything without one, or that ffmpeg can't read, redirects to the file itself.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/thumb/[...path]">) {
  const { id, path: parts } = await ctx.params;
  const dir = currentDataDir();
  if (!dir) return new Response("No business open", { status: 404 });
  const rel = parts.join("/");
  const file = resolveBrowsable(rel, dir);
  if (!file || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
  const thumb = hasThumbnail(rel) ? await thumbnailFor(dir, rel, file) : null;
  if (!thumb) return Response.redirect(new URL(`/api/b/${id}/files/${parts.map(encodeURIComponent).join("/")}`, req.url), 302);
  return new Response(Readable.toWeb(fs.createReadStream(thumb)) as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(fs.statSync(thumb).size),
      // Tile URLs carry the file's mtime (?v=), so a changed file gets a new URL.
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
