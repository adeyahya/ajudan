import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Asset, Contact, ContextPage, Deliverable, ReaderMode } from "@/db/schema";
import { defaultReaderMode, forAgents, readerMode } from "@/lib/context-text";
import { mediaKind, type MediaKind } from "@/lib/media-types";
import { dataDir } from "@/lib/paths";
import { matchIds, type SearchTable } from "@/lib/search";

/**
 * One search over the workspace: docs (Context pages), deliverables (Docs / Work), the
 * library (media/ files and their `assets` rows) and contacts. Teammates use it through
 * search_workspace / search_docs / search_media (worker/workspace-tools.ts); the UI can
 * call it too. Text relevance comes first; what the owner curated (starred files, labeled
 * files, always-read pages, contacts with notes, the owner's own docs) gets a boost, so it
 * wins ties and near-ties. Trash is always left out.
 */

export type WorkspaceType = "doc" | "deliverable" | "asset" | "contact";
export const WORKSPACE_TYPES: WorkspaceType[] = ["doc", "deliverable", "asset", "contact"];

export type WorkspaceHit = {
  type: WorkspaceType;
  /** Context page id, deliverable id, library path ("media/…") or contact id. */
  id: string;
  title: string;
  snippet: string;
  /** Assets: the owner's star. */
  starred?: boolean;
  /** "owner", "system" or "teammate:<id>". */
  createdBy: string;
  href?: string;
  /** Text relevance plus the curation boost (higher is better). */
  score: number;
  /** Owner-curated (what earned a boost). */
  curated: boolean;
  /** Assets: video, image, audio or file. Deliverables: their kind. */
  kind?: string;
  /** Deliverables: their Docs folder. */
  folder?: string | null;
};

export type SearchOptions = {
  types?: WorkspaceType[];
  limit?: number;
  /** Searching for this teammate: pages it may never read are left out, and its always-pages rank higher. */
  teammateId?: string;
  /** search_media: only this kind of library file. */
  mediaKind?: MediaKind;
};

/** How much curation adds to a hit's text score. */
export const BOOST = {
  starredAsset: 5,
  labeledAsset: 2,
  alwaysPage: 3,
  ownerPage: 1,
  ownerDeliverable: 2,
  approvedDeliverable: 1,
  contactNotes: 2,
} as const;

/** Lowercased query words (2+ characters, "#" dropped), deduplicated. */
export function queryWords(query: string) {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => [...w].length >= 2))];
}

/**
 * Text relevance: 3 per word in the title, 1 per occurrence in the text (up to 5 per word),
 * and a snippet around the first hit in the text.
 */
export function textScore(words: string[], title: string, text: string) {
  const t = title.toLowerCase();
  const low = text.toLowerCase();
  let score = 0;
  let first = -1;
  for (const w of words) {
    if (t.includes(w)) score += 3;
    let at = low.indexOf(w);
    if (at >= 0 && (first < 0 || at < first)) first = at;
    for (let n = 0; at >= 0 && n < 5; n++, at = low.indexOf(w, at + w.length)) score++;
  }
  const from = Math.max(0, first - 60);
  const raw = first < 0 ? text.slice(0, 160) : `${from ? "…" : ""}${text.slice(from, first + 140)}${first + 140 < text.length ? "…" : ""}`;
  return { score, snippet: raw.replace(/\s+/g, " ").trim() };
}

/** "owner", or "teammate:<id>" for rows made before created_by existed. */
export function deliverableCreator(d: Pick<Deliverable, "createdBy" | "teammateId">) {
  return d.createdBy ?? (d.teammateId ? `teammate:${d.teammateId}` : "owner");
}

export function workspaceHref(businessId: string, type: WorkspaceType, id: string) {
  const base = `/b/${businessId}`;
  switch (type) {
    case "doc":
      return `${base}/context?page=${id}`;
    case "deliverable":
      return `${base}/docs?doc=${id}`;
    case "contact":
      return `${base}/contacts?c=${id}`;
    case "asset":
      return `${base}/library?f=${encodeURIComponent(id)}`;
  }
}

/** Index hits (or null: no word long enough, scan instead). */
function candidates(table: SearchTable, businessId: string, words: string[]) {
  return matchIds(table, businessId, words, { limit: 500 });
}

const SCAN_LIMIT = 2000;

function searchDocsPart(businessId: string, words: string[], teammateId?: string): WorkspaceHit[] {
  const t = schema.contextPages;
  const ids = candidates("context_pages", businessId, words);
  if (ids && !ids.length) return [];
  const pages: ContextPage[] = db
    .select()
    .from(t)
    .where(and(eq(t.businessId, businessId), isNull(t.deletedAt), ids ? inArray(t.id, ids) : undefined))
    .limit(SCAN_LIMIT)
    .all();
  const rows = teammateId
    ? db
        .select({ pageId: schema.contextReaders.pageId, teammateId: schema.contextReaders.teammateId, mode: schema.contextReaders.mode })
        .from(schema.contextReaders)
        .where(eq(schema.contextReaders.teammateId, teammateId))
        .all()
    : [];
  const out: WorkspaceHit[] = [];
  for (const p of pages) {
    if (p.kind === "database") continue; // the address book: contacts are searched as contacts
    const mode: ReaderMode = teammateId ? readerMode(p, teammateId, rows) : defaultReaderMode(p);
    if (mode === "never") continue;
    const { score, snippet } = textScore(words, p.title, forAgents(p.body));
    if (!score) continue;
    const boost = (mode === "always" ? BOOST.alwaysPage : 0) + (p.createdBy === "owner" ? BOOST.ownerPage : 0);
    out.push({
      type: "doc",
      id: p.id,
      title: p.title,
      snippet,
      createdBy: p.createdBy,
      href: workspaceHref(businessId, "doc", p.id),
      score: score + boost,
      curated: boost > 0,
    });
  }
  return out;
}

function searchDeliverablesPart(businessId: string, words: string[]): WorkspaceHit[] {
  const t = schema.deliverables;
  const ids = candidates("deliverables", businessId, words);
  if (ids && !ids.length) return [];
  const rows = db
    .select()
    .from(t)
    .where(and(eq(t.businessId, businessId), isNull(t.deletedAt), ids ? inArray(t.id, ids) : undefined))
    .orderBy(desc(t.createdAt))
    .limit(SCAN_LIMIT)
    .all();
  const out: WorkspaceHit[] = [];
  for (const d of rows) {
    const { score, snippet } = textScore(words, `${d.title} ${d.folder ?? ""}`, d.content);
    if (!score) continue;
    const createdBy = deliverableCreator(d);
    const boost = (createdBy === "owner" ? BOOST.ownerDeliverable : 0) + (d.status === "approved" || d.status === "published" ? BOOST.approvedDeliverable : 0);
    out.push({
      type: "deliverable",
      id: d.id,
      title: d.title,
      snippet,
      createdBy,
      href: workspaceHref(businessId, "deliverable", d.id),
      score: score + boost,
      curated: boost > 0,
      kind: d.kind,
      folder: d.folder,
    });
  }
  return out;
}

/**
 * The library: every file in media/ by its labels (title, note, tags, album) and its name.
 * Most files have no assets row (nothing for assets_fts to hold), so this reads the folder
 * and the business's rows once and scores them all; a library is hundreds of files, not millions.
 */
function searchAssetsPart(businessId: string, words: string[], kind?: MediaKind): WorkspaceHit[] {
  const t = schema.assets;
  const all = db.select().from(t).where(eq(t.businessId, businessId)).all();
  const rows = new Map(all.map((r) => [r.path, r]));
  const dir = path.join(dataDir(), "media");
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith("."))
        .map((d) => `media/${d.name}`)
    : [];
  const out: WorkspaceHit[] = [];
  for (const rel of files) {
    const r: Asset | undefined = rows.get(rel);
    if (r?.deletedAt) continue;
    if (kind && mediaKind(rel) !== kind) continue;
    const name = path.posix.basename(rel);
    const title = r?.title || name;
    const text = [r?.note, r?.tags.map((x) => `#${x}`).join(" "), r?.album ? `album: ${r.album}` : "", r?.title ? name : ""].filter(Boolean).join(" · ");
    const { score, snippet } = textScore(words, `${title} ${r?.title ? name : ""}`, text);
    if (!score) continue;
    const labeled = !!r && !!(r.title || r.note || r.tags.length || r.album) && r.updatedBy === "owner";
    const boost = (r?.starred ? BOOST.starredAsset : 0) + (labeled ? BOOST.labeledAsset : 0);
    out.push({
      type: "asset",
      id: rel,
      title,
      snippet: snippet || name,
      starred: !!r?.starred,
      createdBy: r?.createdBy ?? "owner",
      href: workspaceHref(businessId, "asset", rel),
      score: score + boost,
      curated: boost > 0,
      kind: mediaKind(rel),
    });
  }
  return out;
}

function searchContactsPart(businessId: string, words: string[]): WorkspaceHit[] {
  const t = schema.contacts;
  const ids = candidates("contacts", businessId, words);
  if (ids && !ids.length) return [];
  const rows: Contact[] = db
    .select()
    .from(t)
    .where(and(eq(t.businessId, businessId), isNull(t.deletedAt), ids ? inArray(t.id, ids) : undefined))
    .limit(SCAN_LIMIT)
    .all();
  const out: WorkspaceHit[] = [];
  for (const c of rows) {
    const text = [c.company, c.phone ? `+${c.phone}` : "", c.email, c.tags.map((x) => `#${x}`).join(" "), c.notes].filter(Boolean).join(" · ");
    const { score, snippet } = textScore(words, c.name, text);
    if (!score) continue;
    const boost = c.notes.trim() ? BOOST.contactNotes : 0;
    out.push({
      type: "contact",
      id: c.id,
      title: c.name,
      snippet,
      createdBy: c.createdBy,
      href: workspaceHref(businessId, "contact", c.id),
      score: score + boost,
      curated: boost > 0,
      kind: c.kind,
    });
  }
  return out;
}

/** Search docs, deliverables, the library and contacts at once, best first. Empty query: nothing. */
export function searchWorkspace(businessId: string, query: string, opts: SearchOptions = {}): WorkspaceHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const types = new Set(opts.types?.length ? opts.types : WORKSPACE_TYPES);
  const hits: WorkspaceHit[] = [
    ...(types.has("doc") ? searchDocsPart(businessId, words, opts.teammateId) : []),
    ...(types.has("deliverable") ? searchDeliverablesPart(businessId, words) : []),
    ...(types.has("asset") ? searchAssetsPart(businessId, words, opts.mediaKind) : []),
    ...(types.has("contact") ? searchContactsPart(businessId, words) : []),
  ];
  return hits.sort((a, b) => b.score - a.score || Number(b.curated) - Number(a.curated) || a.title.localeCompare(b.title)).slice(0, opts.limit ?? 20);
}

/** Context pages and deliverables. */
export const searchDocs = (businessId: string, query: string, opts: Omit<SearchOptions, "types" | "mediaKind"> = {}) =>
  searchWorkspace(businessId, query, { ...opts, types: ["doc", "deliverable"] });

/** Library files, by their labels (index) and file name. */
export const searchMedia = (businessId: string, query: string, opts: Pick<SearchOptions, "limit" | "mediaKind"> = {}) =>
  searchWorkspace(businessId, query, { ...opts, types: ["asset"] });
