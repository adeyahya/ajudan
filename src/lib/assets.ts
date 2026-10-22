import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
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
