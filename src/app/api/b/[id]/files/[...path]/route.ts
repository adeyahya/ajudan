import fs from "node:fs";
import path from "node:path";
import { currentDataDir } from "@/lib/paths";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/** Files the team produced, from the open business folder's work/ directory only. */
export async function GET(_req: Request, ctx: RouteContext<"/api/b/[id]/files/[...path]">) {
  const { path: parts } = await ctx.params;
  const dir = currentDataDir();
  if (!dir) return new Response("No business open", { status: 404 });
  const root = path.join(dir, "work");
  const file = path.resolve(dir, ...parts);
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!file.startsWith(root + path.sep) || !type || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline" },
  });
}
