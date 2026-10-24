import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { exportableDoc } from "@/lib/docs";
import { docHtml, docMarkdown, exportFilename } from "@/lib/docs-export";
import { dateLocale, t, uiLang } from "@/lib/i18n";
import { currentDataDir } from "@/lib/paths";
import { statusTone } from "@/lib/status-tones";

/**
 * Download or print a doc (Docs → … → Export).
 *
 *   GET /api/b/[id]/docs/[docId]/export?format=md     → a Markdown file
 *   GET /api/b/[id]/docs/[docId]/export?format=html   → one standalone HTML file
 *   GET /api/b/[id]/docs/[docId]/export?format=print  → that HTML, opening the print dialog (Save as PDF)
 *
 * Mentions become plain names; images in the business folder point at the files route.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/b/[id]/docs/[docId]/export">) {
  const { id, docId } = await ctx.params;
  if (!currentDataDir()) return new Response("Not found", { status: 404 });
  const business = db.select({ language: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, id)).get();
  const doc = business && exportableDoc(id, docId);
  if (!business || !doc) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "md";
  const headers = (type: string, file?: string) => ({
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    ...(file ? { "Content-Disposition": `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}` } : {}),
  });

  if (format === "md") return new Response(docMarkdown(doc), { headers: headers("text/markdown", exportFilename(doc.title, "md")) });
  if (format !== "html" && format !== "print") return new Response("Unknown format", { status: 400 });

  const print = format === "print";
  // The print view opens in the app (same origin); a downloaded file needs full URLs to reach the app's files.
  const files = `${print ? "" : url.origin}/api/b/${id}/files/`;
  const resolveUrl = (u: string) => (/^(media|work)\//.test(u) ? files + u.split("/").map(encodeURIComponent).join("/") : u);
  const lang = business.language;
  const meta = `${t(lang, statusTone("deliverable", doc.status).label)} · ${doc.createdAt.toLocaleDateString(dateLocale(lang), { dateStyle: "long" })}`;
  const html = docHtml(doc, { resolveUrl, lang: uiLang(lang), meta, print });
  return new Response(html, { headers: headers("text/html", print ? undefined : exportFilename(doc.title, "html")) });
}
