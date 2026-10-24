import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { cleanFilter, isEmptyFilter, type LibraryFilter } from "@/lib/library-filter";
import { dataDir } from "@/lib/paths";

/**
 * Smart albums: saved Library filters ("Starred videos", "#promo from the team"). They're
 * the owner's view settings, not data teammates use, so they live in a small JSON file in
 * the business folder (<folder>/library-views.json) instead of the database. They travel
 * with the folder and are read fresh on every page load.
 */

export type SmartAlbum = { id: string; businessId: string; name: string; filter: LibraryFilter; createdAt: number };

type Store = { version: 1; views: SmartAlbum[] };

const MAX_VIEWS = 100;

export const libraryViewsPath = (dir = dataDir()) => path.join(dir, "library-views.json");

function readStore(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(libraryViewsPath(), "utf8")) as Partial<Store>;
    const views = Array.isArray(raw.views) ? raw.views : [];
    return {
      version: 1,
      views: views
        .filter((v): v is SmartAlbum => !!v && typeof v.id === "string" && typeof v.businessId === "string" && typeof v.name === "string")
        .map((v) => ({ id: v.id, businessId: v.businessId, name: v.name, filter: cleanFilter(v.filter), createdAt: Number(v.createdAt) || 0 })),
    };
  } catch {
    return { version: 1, views: [] };
  }
}

/** Write through a temp file, so a crash never leaves half a file. */
function writeStore(store: Store) {
  const file = libraryViewsPath();
  const tmp = `${file}.${process.pid}.${nanoid(4)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 80);

/** This business's smart albums, in the order they were made. */
export function listLibraryViews(businessId: string): SmartAlbum[] {
  return readStore().views.filter((v) => v.businessId === businessId);
}

/** Save a filter as a smart album. Throws on an empty name or a filter that shows everything. */
export function createLibraryView(businessId: string, name: string, filter: LibraryFilter): SmartAlbum {
  const n = cleanName(name);
  if (!n) throw new Error("Give the smart album a name.");
  const f = cleanFilter(filter);
  if (isEmptyFilter(f)) throw new Error("Pick at least one filter to save.");
  const store = readStore();
  if (store.views.filter((v) => v.businessId === businessId).length >= MAX_VIEWS) throw new Error("Too many smart albums.");
  const view: SmartAlbum = { id: nanoid(10), businessId, name: n, filter: f, createdAt: Date.now() };
  store.views.push(view);
  writeStore(store);
  return view;
}

/** Rename and/or change a smart album's filter. Null when it doesn't exist. */
export function updateLibraryView(businessId: string, id: string, patch: { name?: string; filter?: LibraryFilter }): SmartAlbum | null {
  const store = readStore();
  const view = store.views.find((v) => v.id === id && v.businessId === businessId);
  if (!view) return null;
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    if (!n) throw new Error("Give the smart album a name.");
    view.name = n;
  }
  if (patch.filter !== undefined) {
    const f = cleanFilter(patch.filter);
    if (isEmptyFilter(f)) throw new Error("Pick at least one filter to save.");
    view.filter = f;
  }
  writeStore(store);
  return view;
}

/** Delete a smart album (files are untouched). True when one was removed. */
export function deleteLibraryView(businessId: string, id: string): boolean {
  const store = readStore();
  const next = store.views.filter((v) => !(v.id === id && v.businessId === businessId));
  if (next.length === store.views.length) return false;
  writeStore({ ...store, views: next });
  return true;
}
