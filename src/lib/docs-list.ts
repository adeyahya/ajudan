import type { DeliverableStatus } from "@/db/schema";
import { isInFolder, normalizeFolder } from "@/lib/docs-folders";

/**
 * The Docs list (src/app/b/[id]/docs): one view over saved work (`deliverables`) and the
 * pages the team reads (`context_pages`), without merging the tables. Filters live in the
 * URL. Pure: safe in client components and tests.
 */

export type DocSource = "deliverable" | "context";
/** A deliverable's status, or "context" for a Context page ("team reads this"). */
export type DocStatus = DeliverableStatus | "context";

export type DocItem = {
  source: DocSource;
  id: string;
  title: string;
  kind: string;
  status: DocStatus;
  /** "owner", "system" or "teammate:<id>". */
  by: string;
  folder: string | null;
  /** Last change (or creation), ms. */
  at: number;
};

export const DOC_STATUSES: DeliverableStatus[] = ["draft", "ready_to_post", "approved", "published", "rejected"];
export const STATUS_FILTERS: DocStatus[] = [...DOC_STATUSES, "context"];

export type WhoFilter = "all" | "mine" | "team";
export type DocsFilter = {
  who: WhoFilter;
  status: DocStatus | null;
  /** A folder path, or null for every folder. */
  folder: string | null;
  q: string;
};

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export function parseDocsFilter(sp: Params): DocsFilter {
  const who = one(sp.who);
  const status = one(sp.status) as DocStatus | undefined;
  return {
    who: who === "mine" || who === "team" ? who : "all",
    status: status && STATUS_FILTERS.includes(status) ? status : null,
    folder: normalizeFolder(one(sp.folder)),
    q: (one(sp.q) ?? "").trim().slice(0, 100),
  };
}

/** "owner" for the owner's docs, "teammate:<id>" or "system" otherwise. Old rows have no created_by. */
export function deliverableAuthor(d: { createdBy: string | null; teammateId: string | null }) {
  return d.createdBy ?? (d.teammateId ? `teammate:${d.teammateId}` : "owner");
}

/** The teammate id in "teammate:<id>", or null. */
export const teammateOf = (by: string) => (by.startsWith("teammate:") ? by.slice("teammate:".length) : null);

/**
 * The rows the filter shows. A folder filter shows docs in that folder and under it, and
 * leaves Context pages out (they live in Context's own tree). Text search happens on the
 * server (`matches`: ids that matched, null for no search).
 */
export function filterDocs(items: DocItem[], f: DocsFilter, matches: Set<string> | null = null) {
  return items.filter((d) => {
    if (f.who === "mine" && d.by !== "owner") return false;
    if (f.who === "team" && d.by === "owner") return false;
    if (f.status && d.status !== f.status) return false;
    if (f.folder && (d.source !== "deliverable" || !isInFolder(d.folder, f.folder))) return false;
    if (matches && !matches.has(`${d.source}:${d.id}`)) return false;
    return true;
  });
}

/** The Docs URL for a filter plus extra params (doc, new, …); defaults are left out. */
export function docsHref(businessId: string, f: Partial<DocsFilter>, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  if (f.who && f.who !== "all") p.set("who", f.who);
  if (f.status) p.set("status", f.status);
  if (f.folder) p.set("folder", f.folder);
  if (f.q) p.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/b/${businessId}/docs?${s}` : `/b/${businessId}/docs`;
}
