import type { ContextPage, ContextSection, ContextSuggestion, ReaderMode } from "@/db/schema";

/**
 * The Context workspace's pure text helpers (no database), shared by the server
 * (src/lib/context.ts) and the browser (the editor and the suggestion diffs).
 */

export const SECTIONS: ContextSection[] = ["business", "product", "people", "how_we_work", "team_written"];

/**
 * Icons for Ajudan's own pages (by key). A page's `icon` is an emoji or "lucide:<name>";
 * null means "the default" (these, or a page / database glyph), "" means none.
 */
export const DEFAULT_ICONS: Record<string, string> = {
  about: "lucide:store",
  products: "lucide:package",
  policies: "lucide:scroll-text",
  learned: "lucide:sparkles",
  contacts: "lucide:users",
};

/** The icon to draw for a page: its own, its key's default, or null (the page/database glyph). */
export function pageIcon(page: { icon: string | null; key: string | null }) {
  if (page.icon !== null) return page.icon || null;
  return (page.key && DEFAULT_ICONS[page.key]) || null;
}

/** What teammates get in their prompt from always-pages: whole pages up to these sizes (characters). */
export const PROMPT_BUDGET = { total: 20_000, perPage: 8_000 };

/**
 * The reader mode when the owner hasn't chosen one: the business and how-we-work pages
 * (and the owner's feedback, which replaced the always-read TEAM.md) are always in the
 * prompt; everything else is fetched when needed.
 */
export function defaultReaderMode(page: Pick<ContextPage, "section" | "key" | "kind">): ReaderMode {
  if (page.kind === "database") return "when_needed";
  if (page.key === "learned") return "always";
  return page.section === "business" || page.section === "how_we_work" ? "always" : "when_needed";
}

export function readerMode(page: Pick<ContextPage, "id" | "section" | "key" | "kind">, teammateId: string, rows: { pageId: string; teammateId: string; mode: ReaderMode }[]) {
  return rows.find((r) => r.pageId === page.id && r.teammateId === teammateId)?.mode ?? defaultReaderMode(page);
}

/** Mentions are links the editor writes: [@Title](ajudan://page/<id>). Agents just see "@Title". */
export function forAgents(markdown: string) {
  return markdown.replace(/\[@([^\]]+)\]\(ajudan:\/\/(page|contact)\/[^)]*\)/g, (_, label: string, kind: string) => (kind === "contact" ? `@${label} (contact)` : `@${label}`));
}

export type BudgetItem = { id: string; title: string; chars: number; truncated: boolean };

/**
 * Always-pages for a prompt, in order, each cut at `perPage` and all together at
 * `total`; a cut page says how to read the rest. Pages that don't fit at all are left
 * out (and reported as truncated with 0 chars).
 */
export function budgetPages(pages: { id: string; title: string; body: string }[], budget = PROMPT_BUDGET) {
  let left = budget.total;
  const items: BudgetItem[] = [];
  const parts: string[] = [];
  for (const p of pages) {
    const body = forAgents(p.body).trim() || "(empty)";
    const room = Math.min(budget.perPage, left);
    if (room < 200) {
      items.push({ id: p.id, title: p.title, chars: 0, truncated: true });
      continue;
    }
    const cut = body.length > room;
    const text = cut ? `${body.slice(0, room).replace(/\s+\S*$/, "")}\n\n[… cut here: read_page("${p.title}") for the rest]` : body;
    parts.push(`### ${p.title}\n${text}`);
    items.push({ id: p.id, title: p.title, chars: text.length, truncated: cut });
    left -= text.length;
  }
  return { text: parts.join("\n\n"), items };
}

/** The page after a suggestion: an append goes at the end, a replace is the new page. */
export function applySuggestion(current: string, s: Pick<ContextSuggestion, "kind" | "body">) {
  if (s.kind === "append") return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${s.body.trim()}\n`;
  return s.body;
}

export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** Line diff (LCS), for showing a suggestion as insertions and deletions. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\s+$/, "").split("\n");
  const b = after.replace(/\s+$/, "").split("\n");
  if (!before.trim()) return b.map((text) => ({ op: "add", text }));
  // Big pages: compare the changed middle only.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);
  const lcs: number[][] = Array.from({ length: ma.length + 1 }, () => new Array<number>(mb.length + 1).fill(0));
  for (let i = ma.length - 1; i >= 0; i--) for (let j = mb.length - 1; j >= 0; j--) lcs[i][j] = ma[i] === mb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < ma.length && j < mb.length) {
    if (ma[i] === mb[j]) {
      mid.push({ op: "same", text: ma[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) mid.push({ op: "del", text: ma[i++] });
    else mid.push({ op: "add", text: mb[j++] });
  }
  while (i < ma.length) mid.push({ op: "del", text: ma[i++] });
  while (j < mb.length) mid.push({ op: "add", text: mb[j++] });
  return [...a.slice(0, start).map((text) => ({ op: "same" as const, text })), ...mid, ...a.slice(endA).map((text) => ({ op: "same" as const, text }))];
}

/** Changed lines with a little context around them; long unchanged runs fold to "…". */
export function compactDiff(lines: DiffLine[], context = 2): (DiffLine | { op: "skip"; count: number })[] {
  const keep = lines.map((l, i) => l.op !== "same" || lines.slice(Math.max(0, i - context), i + context + 1).some((x) => x.op !== "same"));
  const out: (DiffLine | { op: "skip"; count: number })[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else {
      const last = out.at(-1);
      if (last?.op === "skip") last.count++;
      else out.push({ op: "skip", count: 1 });
    }
  });
  return out;
}

export type SearchHit = { id: string; title: string; score: number; snippet: string };

/** Pages whose title or text match the query's words (title counts more), best first. */
export function searchPages(pages: { id: string; title: string; body: string }[], query: string, limit = 6): SearchHit[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return [];
  return pages
    .map((p) => {
      const title = p.title.toLowerCase();
      const body = forAgents(p.body);
      const low = body.toLowerCase();
      let score = 0;
      let first = -1;
      for (const w of words) {
        if (title.includes(w)) score += 3;
        let at = low.indexOf(w);
        if (at >= 0 && (first < 0 || at < first)) first = at;
        for (let n = 0; at >= 0 && n < 5; n++, at = low.indexOf(w, at + w.length)) score++;
      }
      const from = Math.max(0, first - 80);
      const snippet = first < 0 ? body.slice(0, 160) : `${from ? "…" : ""}${body.slice(from, first + 160)}…`;
      return { id: p.id, title: p.title, score, snippet: snippet.replace(/\s+/g, " ").trim() };
    })
    .filter((h) => h.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}


/**
 * Markdown as the editor would write it, for comparing: the editor exports "*" bullets,
 * escapes and blank-line runs differently from text written by hand or by a teammate,
 * which isn't a change worth showing.
 */
export function normalizeMarkdown(md: string) {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/^(\s*)[*+] /gm, "$1- ")
    .replace(/\\$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
