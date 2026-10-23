import fs from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { FileMeta } from "@/db/schema";

/**
 * A cache of details that are slow to work out from a file (a markdown title, ffprobe's
 * results), keyed by the file's folder-relative path and valid while its size and mtime
 * match. Listing a folder is cheap (readdir + stat) and stays on disk; only these
 * details come from here. Whoever works one out saves it: the web app or the worker.
 */

export type Stamp = { bytes: number; mtimeMs: number };

/** Whole milliseconds, like a Date's getTime(): stats and Dates of the same file agree. */
export const stampOf = (st: { size: number; mtime: Date }): Stamp => ({ bytes: st.size, mtimeMs: st.mtime.getTime() });

export const isFresh = (row: Pick<FileMeta, "bytes" | "mtimeMs"> | undefined, s: Stamp) => !!row && row.bytes === s.bytes && row.mtimeMs === s.mtimeMs;

/** Folder-relative path for an absolute one, or null when it isn't in the folder. */
export function relInFolder(dir: string, abs: string) {
  const rel = path.relative(dir, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** Cached rows for these paths (fresh or not: compare with isFresh). */
export function metaRows(dir: string, paths: string[]): Map<string, FileMeta> {
  const out = new Map<string, FileMeta>();
  const db = getDb(dir);
  for (let i = 0; i < paths.length; i += 500) {
    for (const r of db.select().from(schema.fileMeta).where(inArray(schema.fileMeta.path, paths.slice(i, i + 500))).all()) out.set(r.path, r);
  }
  return out;
}

export function saveMeta(dir: string, rows: FileMeta[]) {
  if (!rows.length) return;
  const db = getDb(dir);
  db.transaction((tx) => {
    for (const r of rows)
      tx.insert(schema.fileMeta)
        .values(r)
        .onConflictDoUpdate({ target: schema.fileMeta.path, set: { bytes: r.bytes, mtimeMs: r.mtimeMs, title: r.title, probe: r.probe } })
        .run();
  });
}

/**
 * Markdown titles for these files: cached ones as they are, the rest read with
 * `readTitle` and saved. One query for the lot, one read per new or changed file.
 */
export function cachedTitles(dir: string, files: ({ rel: string } & Stamp)[], readTitle: (abs: string) => string | undefined) {
  const rows = metaRows(dir, files.map((f) => f.rel));
  const titles = new Map<string, string | undefined>();
  const fresh: FileMeta[] = [];
  for (const f of files) {
    const row = rows.get(f.rel);
    if (isFresh(row, f)) {
      titles.set(f.rel, row!.title ?? undefined);
      continue;
    }
    const title = readTitle(path.join(dir, f.rel));
    titles.set(f.rel, title);
    fresh.push({ path: f.rel, bytes: f.bytes, mtimeMs: f.mtimeMs, title: title ?? null, probe: null });
  }
  saveMeta(dir, fresh);
  return titles;
}

/** Drop rows for files that are gone or changed (daily, in the worker). Returns how many. */
export function pruneMeta(dir: string) {
  const db = getDb(dir);
  const gone: string[] = [];
  for (const r of db.select({ path: schema.fileMeta.path, bytes: schema.fileMeta.bytes, mtimeMs: schema.fileMeta.mtimeMs }).from(schema.fileMeta).all()) {
    try {
      if (!isFresh(r, stampOf(fs.statSync(path.join(dir, r.path))))) gone.push(r.path);
    } catch {
      gone.push(r.path);
    }
  }
  for (let i = 0; i < gone.length; i += 500) db.delete(schema.fileMeta).where(inArray(schema.fileMeta.path, gone.slice(i, i + 500))).run();
  return gone.length;
}

