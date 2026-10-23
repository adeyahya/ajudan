import type { ContextPageKind, ContextSection, ReaderMode, SuggestionKind } from "@/db/schema";
import type { DiffLine } from "@/lib/context-text";

/** Shapes the Konteks server pages hand to their client components. */

/** A row in the page tree. `icon`: emoji, "lucide:<name>", or null for the page/database glyph. */
export type TreePage = {
  id: string;
  title: string;
  section: ContextSection;
  kind: ContextPageKind;
  key: string | null;
  parentId: string | null;
  icon: string | null;
  pending: number;
  /** Not confirmed or changed in a while (STALE_DAYS in data.ts). */
  stale: boolean;
};

export type CurrentPage = TreePage & {
  body: string;
  blocks: unknown[] | null;
  externalStamp: string | null;
  cover: string | null;
  owner: { kind: "owner" | "system" | "teammate"; name?: string };
  lastCheckedAt: string | null;
};

export type Mate = { id: string; name: string; color: string; title: string };
export type ReaderView = { teammateId: string; mode: ReaderMode };
export type SuggestionView = {
  id: string;
  kind: SuggestionKind;
  /** The page it changes (null for a new page). */
  pageId: string | null;
  pageTitle: string | null;
  /** From a "Reorganize with AI" review (src/lib/reorganize.ts). */
  reorganize: boolean;
  author: string | null;
  authorId: string | null;
  fromChat: boolean;
  reason: string;
  source: string;
  createdAt: string;
  body: string;
  title: string | null;
  section: ContextSection | null;
  changedSince: boolean;
  diff: (DiffLine | { op: "skip"; count: number })[];
};
export type UsageView = { runs: number; fetched: number; byTeammate: { id: string; count: number }[] };
/** A page's text as teammates get it, against the per-page prompt budget. */
export type SizeView = { chars: number; max: number };
export type HistoryItem = { id: string; status: string; author: string | null; kind: SuggestionKind; at: string };
export type CoverImage = { path: string; title: string };
