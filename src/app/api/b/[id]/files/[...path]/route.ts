import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_TYPES } from "@/lib/media";
import { currentDataDir } from "@/lib/paths";

/**
 * Files from the open business folder: the team's work (work/) and the owner's
 * uploads (media/). Supports Range requests so videos play and seek.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/files/[...path]">) {
  const { path: parts } = await ctx.params;
  const dir = currentDataDir();
  if (!dir) return new Response("No business open", { status: 404 });
  const file = path.resolve(dir, ...parts);
  const allowed = ["work", "media"].some((d) => file.startsWith(path.join(dir, d) + path.sep));
  const type = MEDIA_TYPES[path.extname(file).toLowerCase()];
  if (!allowed || !type || !fs.existsSync(file)) return new Response("Not found", { status: 404 });

  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(stream(file, start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(stream(file, 0, size - 1), { headers: { ...headers, "Content-Length": String(size) } });
}

function stream(file: string, start: number, end: number) {
  return Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
}
