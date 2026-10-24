/**
 * Folders in Docs: `deliverables.folder` holds a "/"-separated path ("Marketing/Q3"), or
 * null for the top level. A folder exists while a doc is in it (or in a folder under it);
 * there is no folders table. Pure: safe in client components and tests.
 */

export const MAX_FOLDER_CHARS = 200;

/** "  Marketing / /Q3 " → "Marketing/Q3"; empty → null (the top level). */
export function normalizeFolder(input: string | null | undefined): string | null {
  const path = String(input ?? "")
    .split("/")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("/")
    .slice(0, MAX_FOLDER_CHARS)
    .replace(/\/+$/, "");
  return path || null;
}

/** True when `folder` is `path` or inside it. */
export function isInFolder(folder: string | null, path: string) {
  return !!folder && (folder === path || folder.startsWith(`${path}/`));
}

/** The last segment: "Marketing/Q3" → "Q3". */
export const folderName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The parent path, or null at the top: "Marketing/Q3" → "Marketing". */
export const folderParent = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null);

/**
 * A doc's folder after renaming (or moving) the folder `from` to `to`: the prefix is
 * swapped for docs in `from` or under it; others come back unchanged. `to` null moves
 * them to the top level (sub-folders keep their names).
 */
export function renameFolderPath(folder: string | null, from: string, to: string | null): string | null {
  if (!isInFolder(folder, from)) return folder;
  const rest = folder!.slice(from.length).replace(/^\//, "");
  return normalizeFolder([to ?? "", rest].filter(Boolean).join("/"));
}

/** Renaming `from` to `to` would put a folder inside itself ("A" → "A/B"). */
export function renameIsCircular(from: string, to: string | null) {
  return !!to && to !== from && isInFolder(to, from);
}

export type FolderNode = { path: string; name: string; depth: number; count: number; total: number };

/**
 * The folder tree as a flat, sorted list (parents before children) with each folder's own
 * doc count and the count including sub-folders. `extra` adds folders with no docs yet
 * (one the owner just named).
 */
export function folderTree(folders: (string | null)[], extra: string[] = []): FolderNode[] {
  const own = new Map<string, number>();
  const total = new Map<string, number>();
  const touch = (path: string) => {
    let p: string | null = path;
    while (p) {
      if (!total.has(p)) total.set(p, 0);
      p = folderParent(p);
    }
  };
  for (const raw of folders) {
    const f = normalizeFolder(raw);
    if (!f) continue;
    own.set(f, (own.get(f) ?? 0) + 1);
    touch(f);
    for (let p: string | null = f; p; p = folderParent(p)) total.set(p, (total.get(p) ?? 0) + 1);
  }
  for (const raw of extra) {
    const f = normalizeFolder(raw);
    if (f) touch(f);
  }
  return [...total.keys()]
    .sort((a, b) => {
      const as = a.split("/");
      const bs = b.split("/");
      for (let i = 0; i < Math.min(as.length, bs.length); i++) {
        const c = as[i].localeCompare(bs[i], undefined, { sensitivity: "base", numeric: true });
        if (c) return c;
      }
      return as.length - bs.length;
    })
    .map((path) => ({ path, name: folderName(path), depth: path.split("/").length - 1, count: own.get(path) ?? 0, total: total.get(path) ?? 0 }));
}
