import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Full-text search over Context pages, contacts and work (drizzle/0020_search.sql:
 * trigram FTS5 tables kept in step by triggers). Trigrams match any part of a word,
 * case-insensitively, like the substring search they replace, but only for words of
 * three characters or more; callers fall back to scanning when no word is that long.
 */

const TABLES = {
  context_pages: ["title", "body"],
  contacts: ["name", "company", "phone", "email", "tags", "notes"],
  deliverables: ["title", "content"],
} as const;

export type SearchTable = keyof typeof TABLES;

/** The words the index can find (3+ characters), lowercased and deduplicated. */
export function indexableWords(words: string[]) {
  return [...new Set(words.map((w) => w.toLowerCase()).filter((w) => [...w].length >= 3))];
}

/**
 * Ids of `table` rows in this business whose text contains any (or all) of `words`, best
 * match first. Null when no word is long enough for the index: scan instead.
 */
export function matchIds(table: SearchTable, businessId: string, words: string[], { all = false, limit = 200 }: { all?: boolean; limit?: number } = {}) {
  const terms = indexableWords(words);
  if (!terms.length) return null;
  const fts = `${table}_fts`;
  const query = `{${TABLES[table].join(" ")}}: (${terms.map((w) => `"${w.replace(/"/g, '""')}"`).join(all ? " AND " : " OR ")})`;
  return db
    .all<{ id: string }>(sql`select id from ${sql.identifier(fts)} where ${sql.identifier(fts)} match ${query} and business_id = ${businessId} order by rank limit ${limit}`)
    .map((r) => r.id);
}
