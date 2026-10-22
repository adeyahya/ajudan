import { spawn } from "node:child_process";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resolveBrowsable } from "@/lib/browse";
import { mediaKind } from "@/lib/media";
import { currentDataDir } from "@/lib/paths";

const FFMPEG = process.env.AJUDAN_FFMPEG ?? "ffmpeg";
const RATE = 4000;

/**
 * Waveform peaks for the Studio audio editor: ffmpeg decodes the sound on this Mac (any
 * format, even long videos) instead of the browser loading the whole file.
 * ?file=media/… &bins=900 → { peaks: number[] } (0–1, loudest sample per bin).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/peaks">) {
  const { id } = await ctx.params;
  if (!db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, id)).get()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const rel = url.searchParams.get("file") ?? "";
  const bins = Math.min(4000, Math.max(50, Number(url.searchParams.get("bins")) || 900));
  const dir = currentDataDir();
  const abs = rel.startsWith("media/") && dir ? resolveBrowsable(rel, dir) : null;
  if (!abs || !["audio", "video"].includes(mediaKind(rel))) return Response.json({ error: "not a sound file" }, { status: 404 });

  // Mono 16-bit at a low rate is plenty for drawing.
  const samples = await new Promise<Int16Array | null>((resolve) => {
    const p = spawn(FFMPEG, ["-v", "error", "-i", path.resolve(abs), "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", () => resolve(null));
    p.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      resolve(code === 0 || buf.length ? new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)) : null);
    });
  });
  if (!samples?.length) return Response.json({ error: "couldn't read the sound" }, { status: 422 });
  const per = samples.length / bins;
  const peaks = Array.from({ length: bins }, (_, b) => {
    let m = 0;
    for (let i = Math.floor(b * per), e = Math.min(samples.length, Math.floor((b + 1) * per)); i < e; i++) m = Math.max(m, Math.abs(samples[i]));
    return Math.round((m / 32768) * 1000) / 1000;
  });
  return Response.json({ peaks }, { headers: { "Cache-Control": "private, max-age=600" } });
}
