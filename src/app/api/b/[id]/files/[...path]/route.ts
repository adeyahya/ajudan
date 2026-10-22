import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { contentType, resolveBrowsable } from "@/lib/browse";
import { currentDataDir } from "@/lib/paths";

/**
 * Files from the open business folder that the Files tab may show (src/lib/browse.ts):
 * work/, media/ and teammates' folders. Supports Range requests so videos play and seek.
 * ?download=1 saves instead of showing.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/files/[...path]">) {
  const { path: parts } = await ctx.params;
  const dir = currentDataDir();
  if (!dir) return new Response("No business open", { status: 404 });
  const rel = parts.join("/");
  const file = resolveBrowsable(rel, dir);
  const type = contentType(rel);
  if (!file || !type || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");

  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  // Team-made text and SVG are shown, never run as pages.
  if (/^(text\/|application\/json|image\/svg)/.test(type)) headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
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
