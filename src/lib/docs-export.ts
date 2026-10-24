import { stripMentions } from "@/lib/docs-mentions";

/**
 * Docs export (GET /api/b/[id]/docs/[docId]/export): a doc as a Markdown file, as one
 * standalone HTML file, or as that HTML with the print dialog (the browser's "Save as
 * PDF"). The markdown → HTML conversion is a small, dependency-free subset of GFM
 * (headings, paragraphs, lists, task lists, quotes, code, tables, links, images, bold,
 * italic, strikethrough); everything the doc says is escaped, so no HTML gets through.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Links and images may point at the web, mail, a phone, or a relative path; anything else (javascript:, data:) is dropped. */
function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return null;
  return u;
}

type Opts = { resolveUrl?: (url: string) => string };

/** Inline markdown on one block's raw text → HTML. */
function inline(raw: string, opts: Opts): string {
  const slots: string[] = [];
  const keep = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  const url = (u: string) => {
    const s = safeUrl(u);
    return s === null ? null : escapeHtml(opts.resolveUrl ? opts.resolveUrl(s) : s);
  };
  let s = raw
    // Code spans first: nothing inside them is markdown.
    .replace(/`([^`\n]+)`/g, (_m, c: string) => keep(`<code>${escapeHtml(c)}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, src: string) => {
      const u = url(src);
      return u ? keep(`<img src="${u}" alt="${escapeHtml(alt)}">`) : escapeHtml(alt);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, href: string) => {
      const u = url(href);
      return u ? keep(`<a href="${u}">${inline(text, opts)}</a>`) : text;
    });
  s = escapeHtml(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/ {2,}\n/g, "<br>\n");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => slots[Number(i)]);
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function markdownToHtml(markdown: string, opts: Opts = {}): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const isBlockStart = (k: number) => {
    const l = lines[k];
    return /^\s*(#{1,6}\s|```|~~~|>|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$)/.test(l) || LIST_RE.test(l) || (l.includes("|") && isTableSep(lines[k + 1] ?? ""));
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2], opts)}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(body.join("\n"), opts)}</blockquote>`);
      continue;
    }
    // Tables: a header row, then a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : null));
      const cell = (tag: string, c: string, k: number) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(c, opts)}</${tag}>`;
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = splitRow(lines[i++]);
        rows.push(`<tr>${head.map((_h, k) => cell("td", cells[k] ?? "", k)).join("")}</tr>`);
      }
      out.push(`<table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
      continue;
    }
    // Lists (nested by indentation)
    if (LIST_RE.test(line)) {
      const stack: { tag: "ul" | "ol"; indent: number }[] = [];
      let html = "";
      let open = false;
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m) {
          // A wrapped line continues the item; a blank line or another block ends the list.
          if (lines[i].trim() && open && /^\s+/.test(lines[i]) && !isBlockStart(i)) {
            html += ` ${inline(lines[i].trim(), opts)}`;
            i++;
            continue;
          }
          break;
        }
        const indent = m[1].replace(/\t/g, "    ").length;
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length && indent < stack[stack.length - 1].indent) {
          html += `</li></${stack.pop()!.tag}>`;
        }
        const top = stack[stack.length - 1];
        if (!top || indent > top.indent) {
          stack.push({ tag, indent });
          html += `<${tag}>`;
        } else {
          html += "</li>";
        }
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
        html += task
          ? `<li class="task"><input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ${inline(task[2], opts)}`
          : `<li>${inline(m[3], opts)}`;
        open = true;
        i++;
      }
      while (stack.length) html += `</li></${stack.pop()!.tag}>`;
      out.push(html);
      continue;
    }
    // Paragraph: lines until a blank line or another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(i)) para.push(lines[i++]);
    out.push(`<p>${inline(para.join("\n"), opts)}</p>`);
  }
  return out.join("\n");
}

export type ExportDoc = { title: string; content: string; kind?: string; status?: string; attachments?: string[] };

/** The doc as a Markdown file: the title as a heading, mentions as plain names. */
export function docMarkdown(d: ExportDoc) {
  const body = stripMentions(d.content).trim();
  return `# ${d.title}\n\n${body}\n`;
}

const CSS = `
:root{color-scheme:light}
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:#1f1f1f;background:#fff;max-width:760px;margin:40px auto;padding:0 24px}
h1{font-size:30px;line-height:1.25;margin:0 0 8px}h2{font-size:21px;margin:28px 0 8px}h3{font-size:17px;margin:22px 0 6px}
.meta{color:#787774;font-size:13px;margin:0 0 28px}
a{color:#2563eb}img{max-width:100%;border-radius:6px}
blockquote{border-left:3px solid #d9d9d6;margin:12px 0;padding:0 14px;color:#555}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f1ef;padding:1px 4px;border-radius:4px}
pre{background:#f7f7f5;padding:12px 14px;border-radius:6px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}th,td{border:1px solid #e3e3e0;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f7f7f5}
hr{border:0;border-top:1px solid #e3e3e0;margin:24px 0}li.task{list-style:none;margin-left:-1.2em}
.attachments{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}.attachments img{width:220px}
@media print{body{margin:0;max-width:none}a{color:inherit;text-decoration:none}@page{margin:18mm}}
`;

/**
 * The doc as one HTML file with its own styles. `resolveUrl` points relative paths
 * (media/…, work/…) at the app's files route; `print` opens the print dialog on load.
 */
export function docHtml(d: ExportDoc, opts: Opts & { lang?: string; meta?: string; print?: boolean } = {}) {
  const body = markdownToHtml(stripMentions(d.content), opts);
  const images = (d.attachments ?? []).filter((p) => /\.(png|jpe?g|webp|gif|svg)$/i.test(p));
  const resolve = (p: string) => escapeHtml(opts.resolveUrl ? opts.resolveUrl(p) : p);
  return `<!doctype html>
<html lang="${escapeHtml(opts.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(d.title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${escapeHtml(d.title)}</h1>
${opts.meta ? `<p class="meta">${escapeHtml(opts.meta)}</p>` : ""}
${body}
${images.length ? `<div class="attachments">${images.map((p) => `<img src="${resolve(p)}" alt="">`).join("")}</div>` : ""}
${opts.print ? `<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>` : ""}
</body>
</html>
`;
}

/** A file name from the title: "Price list (May)" → "Price-list-May.md". */
export function exportFilename(title: string, ext: string) {
  const base = title.normalize("NFKD").replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "doc";
  return `${base}.${ext}`;
}
