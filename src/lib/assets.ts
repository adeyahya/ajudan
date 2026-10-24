import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Asset } from "@/db/schema";
import { mediaKind, type MediaKind } from "@/lib/media-types";
import { dataDir } from "@/lib/paths";
import { NO_LABELS, recordHistory } from "@/lib/object-history";
import { softDelete } from "@/lib/trash";

/**
 * The owner's asset library: the files in media/ plus how the owner organized them
 * (title, note, tags, album, star: the `assets` table). Organizing costs no Claude
 * usage, so it's something to do while the team rests; teammates see it in list_media.
 *
 * The Library page also shows what the team made (work/images/, work/videos/: rendered
 * designs and videos) with source "team". Those files can be organized and trashed the
 * same way; their assets row is keyed by their "work/…" path.
 */

/** Where the team's media lands (worker/tools.ts render_image, worker/video.ts). */
export const TEAM_MEDIA_DIRS = ["work/images", "work/videos"] as const;

/** "owner": uploaded or made in the Studio (media/); "team": a teammate made it (work/…). */
export type LibrarySource = "owner" | "team";

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
  source: LibrarySource;
  /** "owner" or "teammate:<id>" when known (from the assets row). */
  createdBy: string | null;
};

/** media/<file> only: no folders, dotfiles or anything outside. */
export function isLibraryPath(rel: string) {
  return /^media\/[^/\\]+$/.test(rel) && !path.basename(rel).startsWith(".") && path.posix.normalize(rel) === rel;
}

/** work/images/<file> or work/videos/<file>: a file the team made, shown in the Library. */
export function isTeamMediaPath(rel: string) {
  return /^work\/(images|videos)\/[^/\\]+$/.test(rel) && !path.basename(rel).startsWith(".") && path.posix.normalize(rel) === rel;
}

/** A path the Library can organize and trash: media/<file> or a team-made file. */
export function isOrganizablePath(rel: string) {
  return isLibraryPath(rel) || isTeamMediaPath(rel);
}

export function cleanTags(tags: string[]) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 20);
}

/** Library paths in Trash (an assets row with deleted_at): their files stay on disk but are hidden. */
export function trashedPaths(businessId?: string) {
  return new Set(
    db
      .select({ path: schema.assets.path })
      .from(schema.assets)
      .where(and(isNotNull(schema.assets.deletedAt), businessId ? eq(schema.assets.businessId, businessId) : undefined))
      .all()
      .map((r) => r.path),
  );
}

/** Files directly in one folder-relative directory, skipping dotfiles and (when asked) non-media. */
function filesIn(rel: string, mediaOnly: boolean) {
  const dir = path.join(dataDir(), rel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && (!mediaOnly || mediaKind(d.name) !== "file"))
    .map((d) => ({ rel: `${rel}/${d.name}`, name: d.name, abs: path.join(dir, d.name) }));
}

/**
 * Every file in the media library with its organization, newest first. Files in Trash are
 * left out. With `team`, also the images and videos teammates made (work/images/,
 * work/videos/), marked source "team"; other callers keep the plain media/ library.
 */
export function listLibrary(businessId: string, { team = false }: { team?: boolean } = {}): LibraryItem[] {
  const files = [...filesIn("media", false), ...(team ? TEAM_MEDIA_DIRS.flatMap((d) => filesIn(d, true)) : [])];
  if (!files.length) return [];
  const rows = new Map(
    db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.businessId, businessId))
      .all()
      .map((r) => [r.path, r]),
  );
  return files
    .filter((f) => !rows.get(f.rel)?.deletedAt)
    .map((f) => {
      const st = fs.statSync(f.abs);
      const r = rows.get(f.rel);
      const byTeam = f.rel.startsWith("work/") || !!r?.createdBy.startsWith("teammate:");
      return {
        path: f.rel,
        name: f.name,
        kind: mediaKind(f.name),
        bytes: st.size,
        mtime: st.mtimeMs,
        title: r?.title ?? "",
        note: r?.note ?? "",
        tags: r?.tags ?? [],
        album: r?.album ?? null,
        starred: r?.starred ?? false,
        source: byTeam ? ("team" as const) : ("owner" as const),
        createdBy: r?.createdBy ?? null,
      };
    })
    .sort((x, y) => y.mtime - x.mtime);
}

export type AssetPatch = Partial<Pick<Asset, "title" | "note" | "tags" | "album" | "starred">>;

/**
 * Change how files are organized (creates their rows as needed). Only files that exist:
 * media/ files and the team's work/images/, work/videos/ files. With `by` ("owner" or
 * "teammate:<id>") the change is stamped as theirs (updated_by) and a snapshot goes into
 * object_history; without it nothing is attributed (older callers).
 */
export function organize(businessId: string, paths: string[], patch: AssetPatch, addTags: string[] = [], by?: string) {
  const dir = dataDir();
  const valid = [...new Set(paths)].filter((p) => isOrganizablePath(p) && fs.existsSync(path.join(dir, p)));
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
  for (const k of Object.keys(clean) as (keyof AssetPatch)[]) if (clean[k] === undefined) delete clean[k];
  if (clean.tags) clean.tags = cleanTags(clean.tags);
  if (clean.album !== undefined) clean.album = clean.album?.trim() || null;
  if (clean.title !== undefined) clean.title = clean.title.trim().slice(0, 200);
  if (clean.note !== undefined) clean.note = clean.note.trim().slice(0, 4000);
  const stamp = by ? { updatedBy: by } : {};
  db.transaction((tx) => {
    for (const p of valid) {
      const cur = existing.get(p);
      const tags = cleanTags([...(clean.tags ?? cur?.tags ?? []), ...addTags]);
      const row = cur
        ? tx.update(schema.assets).set({ ...clean, tags, ...stamp }).where(eq(schema.assets.path, p)).returning().get()
        : tx
            .insert(schema.assets)
            // A first labels row doesn't make the file theirs: an upload in media/ stays the owner's.
            .values({ path: p, businessId, ...clean, tags, ...(by ? { createdBy: isTeamMediaPath(p) ? by : "owner", updatedBy: by } : {}) })
            .returning()
            .get();
      // Labels are an update even on a file's first row, so Undo clears them instead of trashing the file.
      if (by && row && organizationChanged(cur, row)) recordHistory({ businessId, type: "asset", id: p, snapshot: row, before: cur ?? NO_LABELS, action: "update", by });
    }
  });
  return valid.length;
}

/** Whether organizing changed anything worth a history entry. */
function organizationChanged(before: Asset | undefined, after: Asset) {
  if (!before) return true;
  const pick = (r: Asset) => JSON.stringify([r.title, r.note, r.tags, r.album, r.starred]);
  return pick(before) !== pick(after);
}

/**
 * Move files to Trash (src/lib/trash.ts): they stay on disk, hidden from the library and
 * list_media, until restored or purged. Returns how many were moved.
 */
export function deleteFromLibrary(businessId: string, paths: string[], by = "owner") {
  let n = 0;
  for (const p of paths) {
    if (!isOrganizablePath(p) || !fs.existsSync(path.join(dataDir(), p))) continue;
    if (softDelete(businessId, "asset", p, by)) n++;
  }
  return n;
}

/** Delete files from the library for good (and their organization). Trash's purge uses this. */
export function purgeFromLibrary(businessId: string, paths: string[]) {
  const dir = dataDir();
  let n = 0;
  for (const p of paths) {
    if (!isOrganizablePath(p)) continue;
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
  const trashed = trashedPaths();
  const same = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && `media/${d.name}` !== except && !trashed.has(`media/${d.name}`))
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
  return purgeFromLibrary(businessId, gone);
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
