import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Asset } from "@/db/schema";
import { mediaKind, type MediaKind } from "@/lib/media-types";
import { dataDir } from "@/lib/paths";

/**
 * The owner's asset library: the files in media/ plus how the owner organized them
 * (title, note, tags, album, star: the `assets` table). Organizing costs no Claude
 * usage, so it's something to do while the team rests; teammates see it in list_media.
 */

export type LibraryItem = {
  path: string;
  name: string;
  kind: MediaKind;
  bytes: number;
  mtime: number;
  title: string;
  note: string;
  tags: string[];
  album: string | null;
  starred: boolean;
};

/** media/<file> only: no folders, dotfiles or anything outside. */
export function isLibraryPath(rel: string) {
  return /^media\/[^/\\]+$/.test(rel) && !path.basename(rel).startsWith(".") && path.posix.normalize(rel) === rel;
}

export function cleanTags(tags: string[]) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 20);
}

/** Every file in the media library with its organization, newest first. */
export function listLibrary(businessId: string): LibraryItem[] {
  const dir = path.join(dataDir(), "media");
  if (!fs.existsSync(dir)) return [];
  const rows = new Map(
    db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.businessId, businessId))
      .all()
      .map((r) => [r.path, r]),
  );
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .map((d) => {
      const rel = `media/${d.name}`;
      const st = fs.statSync(path.join(dir, d.name));
      const r = rows.get(rel);
      return {
        path: rel,
        name: d.name,
        kind: mediaKind(d.name),
        bytes: st.size,
        mtime: st.mtimeMs,
        title: r?.title ?? "",
        note: r?.note ?? "",
        tags: r?.tags ?? [],
        album: r?.album ?? null,
        starred: r?.starred ?? false,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export type AssetPatch = Partial<Pick<Asset, "title" | "note" | "tags" | "album" | "starred">>;

/** Change how files are organized (creates their rows as needed). Only files that exist. */
export function organize(businessId: string, paths: string[], patch: AssetPatch, addTags: string[] = []) {
  const dir = dataDir();
  const valid = paths.filter((p) => isLibraryPath(p) && fs.existsSync(path.join(dir, p)));
  if (!valid.length) return 0;
  const existing = new Map(
    db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.businessId, businessId), inArray(schema.assets.path, valid)))
      .all()
      .map((r) => [r.path, r]),
  );
  const clean: AssetPatch = { ...patch };
  if (clean.tags) clean.tags = cleanTags(clean.tags);
  if (clean.album !== undefined) clean.album = clean.album?.trim() || null;
  if (clean.title !== undefined) clean.title = clean.title.trim().slice(0, 200);
  if (clean.note !== undefined) clean.note = clean.note.trim().slice(0, 4000);
  db.transaction((tx) => {
    for (const p of valid) {
      const cur = existing.get(p);
      const tags = cleanTags([...(clean.tags ?? cur?.tags ?? []), ...addTags]);
      if (cur) tx.update(schema.assets).set({ ...clean, tags }).where(eq(schema.assets.path, p)).run();
      else tx.insert(schema.assets).values({ path: p, businessId, ...clean, tags }).run();
    }
  });
  return valid.length;
}

/** Delete files from the library for good (and their organization). */
export function deleteFromLibrary(businessId: string, paths: string[]) {
  const dir = dataDir();
  let n = 0;
  for (const p of paths) {
    if (!isLibraryPath(p)) continue;
    fs.rmSync(path.join(dir, p), { force: true });
    db.delete(schema.assets).where(and(eq(schema.assets.businessId, businessId), eq(schema.assets.path, p))).run();
    n++;
  }
  return n;
}

/** Content hash of a file, streamed (videos can be gigabytes). */
export function hashFile(abs: string) {
  return new Promise<string>((resolve, reject) => {
    const h = createHash("sha1");
    fs.createReadStream(abs)
      .on("data", (chunk) => h.update(chunk))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** An existing library file with exactly these bytes, if there is one (only same-size files are read). */
export async function findSameFile(abs: string, except?: string) {
  const bytes = fs.statSync(abs).size;
  const dir = path.join(dataDir(), "media");
  if (!bytes || !fs.existsSync(dir)) return null;
  const same = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && `media/${d.name}` !== except)
    .filter((d) => fs.statSync(path.join(dir, d.name)).size === bytes);
  if (!same.length) return null;
  const hash = await hashFile(abs);
  for (const d of same) if ((await hashFile(path.join(dir, d.name))) === hash) return `media/${d.name}`;
  return null;
}

/** One file kept, and copies with exactly the same bytes. */
export type DuplicateGroup = { keep: string; copies: string[]; bytes: number };

/** The copy worth keeping: starred, then organized (title, note, album, tags), then the oldest. */
function keeperFirst(a: LibraryItem, b: LibraryItem) {
  const score = (i: LibraryItem) => (i.starred ? 1000 : 0) + (i.title ? 100 : 0) + (i.note ? 100 : 0) + (i.album ? 100 : 0) + i.tags.length;
  return score(b) - score(a) || a.mtime - b.mtime;
}

/**
 * Files in the library with identical content (the same photo sent twice in chat).
 * Only files that share a size are hashed, so this stays cheap with big videos.
 */
export async function findDuplicates(businessId: string): Promise<DuplicateGroup[]> {
  const dir = dataDir();
  const bySize = new Map<number, LibraryItem[]>();
  for (const i of listLibrary(businessId)) if (i.bytes > 0) bySize.set(i.bytes, [...(bySize.get(i.bytes) ?? []), i]);
  const groups: DuplicateGroup[] = [];
  for (const [bytes, same] of bySize) {
    if (same.length < 2) continue;
    const byHash = new Map<string, LibraryItem[]>();
    for (const i of same) {
      const h = await hashFile(path.join(dir, i.path));
      byHash.set(h, [...(byHash.get(h) ?? []), i]);
    }
    for (const g of byHash.values()) {
      if (g.length < 2) continue;
      const [keep, ...copies] = g.sort(keeperFirst);
      groups.push({ keep: keep.path, copies: copies.map((c) => c.path), bytes });
    }
  }
  return groups.sort((a, b) => b.bytes * b.copies.length - a.bytes * a.copies.length);
}

/** Swap one library path for another inside stored JSON (attachments, edit specs, page blocks). */
function swapPath<T>(value: T, from: string, to: string): T {
  return JSON.parse(JSON.stringify(value).replaceAll(JSON.stringify(from), JSON.stringify(to))) as T;
}

/**
 * Remove copies of `keep`, after checking they really are the same bytes. Labels typed on a
 * copy carry over to the kept file, and tasks, messages, docs, edits and page covers that
 * pointed at a copy now point at the kept file, so nothing that used it breaks.
 */
export async function mergeDuplicates(businessId: string, keep: string, copies: string[]) {
  const dir = dataDir();
  if (!isLibraryPath(keep) || !fs.existsSync(path.join(dir, keep))) return 0;
  const keepHash = await hashFile(path.join(dir, keep));
  const gone: string[] = [];
  for (const c of new Set(copies)) {
    if (c === keep || !isLibraryPath(c) || !fs.existsSync(path.join(dir, c))) continue;
    if ((await hashFile(path.join(dir, c))) === keepHash) gone.push(c);
  }
  if (!gone.length) return 0;

  const rows = assetRows(businessId, [keep, ...gone]);
  const kept = rows.get(keep);
  const others = gone.map((c) => rows.get(c)).filter((r): r is Asset => !!r);
  const patch: AssetPatch = {
    title: kept?.title || others.find((r) => r.title)?.title || "",
    note: kept?.note || others.find((r) => r.note)?.note || "",
    album: kept?.album ?? others.find((r) => r.album)?.album ?? null,
    starred: !!kept?.starred || others.some((r) => r.starred),
    tags: [...(kept?.tags ?? []), ...others.flatMap((r) => r.tags)],
  };
  if (kept || others.length) organize(businessId, [keep], patch);

  const has = (col: Parameters<typeof sql>[1], p: string) => sql`instr(${col}, ${JSON.stringify(p)}) > 0`;
  db.transaction((tx) => {
    for (const from of gone) {
      for (const table of [schema.tasks, schema.deliverables, schema.humanMessages] as const) {
        const hits = tx
          .select({ id: table.id, attachments: table.attachments })
          .from(table)
          .where(and(eq(table.businessId, businessId), has(table.attachments, from)))
          .all();
        for (const r of hits) tx.update(table).set({ attachments: swapPath(r.attachments, from, keep) }).where(eq(table.id, r.id)).run();
      }
      const edits = tx
        .select({ id: schema.edits.id, spec: schema.edits.spec })
        .from(schema.edits)
        .where(and(eq(schema.edits.businessId, businessId), has(schema.edits.spec, from)))
        .all();
      for (const e of edits) tx.update(schema.edits).set({ spec: swapPath(e.spec, from, keep) }).where(eq(schema.edits.id, e.id)).run();
      tx.update(schema.edits)
        .set({ output: keep })
        .where(and(eq(schema.edits.businessId, businessId), eq(schema.edits.output, from)))
        .run();
      tx.update(schema.contextPages)
        .set({ cover: keep })
        .where(and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.cover, from)))
        .run();
      const pages = tx
        .select({ id: schema.contextPages.id, blocks: schema.contextPages.blocks })
        .from(schema.contextPages)
        .where(and(eq(schema.contextPages.businessId, businessId), has(schema.contextPages.blocks, from)))
        .all();
      for (const pg of pages) tx.update(schema.contextPages).set({ blocks: swapPath(pg.blocks, from, keep) }).where(eq(schema.contextPages.id, pg.id)).run();
    }
  });
  return deleteFromLibrary(businessId, gone);
}

/** Organization for some files, for teammates' list_media. */
export function assetRows(businessId: string, paths: string[]) {
  if (!paths.length) return new Map<string, Asset>();
  return new Map(
    db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.businessId, businessId), inArray(schema.assets.path, paths)))
      .all()
      .map((r) => [r.path, r]),
  );
}

/** "★ "Sakura washi close-up" [album: Payday promo; #washi #sakura] Note: use as the cover" */
export function describeOrganization(a: Pick<Asset, "title" | "note" | "tags" | "album" | "starred"> | undefined) {
  if (!a) return "";
  const bits: string[] = [];
  if (a.starred) bits.push("★ owner's pick");
  if (a.title) bits.push(`"${a.title}"`);
  const meta = [a.album ? `album: ${a.album}` : "", a.tags.length ? a.tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean).join("; ");
  if (meta) bits.push(`[${meta}]`);
  if (a.note) bits.push(`Owner's note: ${a.note.replace(/\s+/g, " ")}`);
  return bits.join(" ");
}
