import type { MediaKind } from "@/lib/media-types";

/**
 * Library filters: what the toolbar picks and what a smart album saves
 * (src/lib/library-views.ts). Plain module, no Node imports: the Library page filters on
 * the client with the same rules the tests check.
 */

export type LibrarySourceFilter = "owner" | "team";

export type LibraryFilter = {
  /** Words that must all appear in the name, title, note, album or tags. */
  q?: string;
  /** Every one of these tags. */
  tags?: string[];
  kind?: MediaKind;
  starred?: boolean;
  source?: LibrarySourceFilter;
  album?: string;
};

/** The fields a filter looks at (LibraryItem has them all). */
export type FilterableItem = {
  path: string;
  name: string;
  kind: MediaKind;
  title: string;
  note: string;
  tags: string[];
  album: string | null;
  starred: boolean;
  source: LibrarySourceFilter;
};

const KINDS: MediaKind[] = ["image", "video", "audio", "file"];
const SOURCES: LibrarySourceFilter[] = ["owner", "team"];

/** Lowercased words of a search box. */
export function searchWords(q: string | undefined) {
  return (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when the item's own text has every word (a substring match, like the trigram index). */
export function textMatches(item: FilterableItem, words: string[]) {
  if (!words.length) return true;
  const hay = [item.name, item.title, item.note, item.album ?? "", ...item.tags].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w.replace(/^#/, "")));
}

/**
 * Whether an item passes a filter. `hits` are paths the full-text index matched for the
 * query (best first); an item in it passes the text part even if its own fields don't
 * show every word.
 */
export function matchesFilter(item: FilterableItem, f: LibraryFilter, hits?: ReadonlySet<string> | null) {
  if (f.kind && item.kind !== f.kind) return false;
  if (f.source && item.source !== f.source) return false;
  if (f.starred && !item.starred) return false;
  if (f.album && item.album !== f.album) return false;
  if (f.tags?.length && !f.tags.every((t) => item.tags.includes(t))) return false;
  const words = searchWords(f.q);
  if (words.length && !textMatches(item, words) && !hits?.has(item.path)) return false;
  return true;
}

/**
 * Items passing the filter. With `rank` (full-text hits, best first) and a query, the
 * ranked ones come first in that order and the rest keep their order (newest first).
 */
export function applyFilter<T extends FilterableItem>(items: T[], f: LibraryFilter, rank?: string[] | null): T[] {
  const hits = rank ? new Set(rank) : null;
  const out = items.filter((i) => matchesFilter(i, f, hits));
  if (!rank?.length || !searchWords(f.q).length) return out;
  const pos = new Map(rank.map((p, n) => [p, n]));
  return out
    .map((item, n) => ({ item, n }))
    .sort((a, b) => (pos.get(a.item.path) ?? rank.length + a.n) - (pos.get(b.item.path) ?? rank.length + b.n))
    .map((x) => x.item);
}

/** A filter with only known, non-empty fields (what gets saved). */
export function cleanFilter(raw: unknown): LibraryFilter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const f: LibraryFilter = {};
  const q = typeof r.q === "string" ? r.q.trim().slice(0, 200) : "";
  if (q) f.q = q;
  if (Array.isArray(r.tags)) {
    const tags = [
      ...new Set(
        r.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
          .filter(Boolean),
      ),
    ].slice(0, 20);
    if (tags.length) f.tags = tags;
  }
  if (KINDS.includes(r.kind as MediaKind)) f.kind = r.kind as MediaKind;
  if (r.starred === true) f.starred = true;
  if (SOURCES.includes(r.source as LibrarySourceFilter)) f.source = r.source as LibrarySourceFilter;
  const album = typeof r.album === "string" ? r.album.trim().slice(0, 200) : "";
  if (album) f.album = album;
  return f;
}

/**
 * `b` narrowing `a` (a smart album or sidebar pick, then the toolbar): search words and
 * tags add up, a star in either counts, and `b`'s kind, source and album win.
 */
export function mergeFilters(a: LibraryFilter, b: LibraryFilter): LibraryFilter {
  return cleanFilter({
    q: [a.q, b.q].filter(Boolean).join(" "),
    tags: [...(a.tags ?? []), ...(b.tags ?? [])],
    kind: b.kind ?? a.kind,
    starred: !!(a.starred || b.starred),
    source: b.source ?? a.source,
    album: b.album ?? a.album,
  });
}

/** Same filter (after cleaning), whatever the key order. */
export const sameFilter = (a: LibraryFilter, b: LibraryFilter) => {
  const key = (f: LibraryFilter) => {
    const c = cleanFilter(f);
    return JSON.stringify([c.q ?? "", [...(c.tags ?? [])].sort(), c.kind ?? "", !!c.starred, c.source ?? "", c.album ?? ""]);
  };
  return key(a) === key(b);
};

/** True when the filter has nothing in it (it would show everything). */
export const isEmptyFilter = (f: LibraryFilter) => Object.keys(cleanFilter(f)).length === 0;
