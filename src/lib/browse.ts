import fs from "node:fs";
import path from "node:path";
import { MEDIA_TYPES, mediaKind } from "@/lib/media-types";
import { currentDataDir } from "@/lib/paths";

/**
 * What the owner can browse in a business folder (the Files tab): the team's work,
 * the media library and the teammates' folders (memory, notes, drafts, renders).
 * Never the database, the browser profile, WhatsApp, backups, logs or dotfiles
 * (.secrets.json, .worker.lock, render scratch).
 */

export const ROOTS = [
  { key: "work", label: "Work", hint: "Everything the team saved: posts, reports, images, videos" },
  { key: "media", label: "Media library", hint: "What you and your people sent: footage, photos, music" },
  { key: "teammates", label: "Teammates", hint: "Each teammate's folder: memory, notes, drafts" },
] as const;

export type FileType = "markdown" | "image" | "video" | "audio" | "pdf" | "csv" | "json" | "text" | "other";

const TEXT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".html": "text/plain; charset=utf-8", // shown as source, never run
  ".log": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
};

/** Content type to serve a browsable file with, or undefined if it isn't served. */
export function contentType(rel: string) {
  const ext = path.extname(rel).toLowerCase();
  return MEDIA_TYPES[ext] ?? TEXT_TYPES[ext];
}

export function fileType(rel: string): FileType {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".csv") return "csv";
  if (ext === ".json") return "json";
  if (ext === ".pdf") return "pdf";
  const k = mediaKind(rel);
  if (k === "image" || k === "video" || k === "audio") return k;
  return TEXT_TYPES[ext] ? "text" : "other";
}

/** "work/images/x.png" → normalized, or null if it's outside what may be browsed. */
export function cleanRel(rel: string | undefined | null) {
  const clean = path.posix.normalize(String(rel ?? "").replace(/\\/g, "/")).replace(/^\/+|\/+$/g, "");
  if (!clean || clean === ".") return "";
  const parts = clean.split("/");
  if (parts.some((p) => p === ".." || p.startsWith("."))) return null;
  if (!ROOTS.some((r) => r.key === parts[0])) return null;
  return clean;
}

/** Absolute path for a browsable rel path, refusing symlinks that lead outside it. */
export function resolveBrowsable(rel: string, dir = currentDataDir()) {
  const clean = cleanRel(rel);
  if (clean === null || !dir) return null;
  if (!clean) return dir;
  const abs = path.join(dir, clean);
  if (!fs.existsSync(abs)) return null;
  const real = fs.realpathSync(abs);
  const root = fs.realpathSync(path.join(dir, clean.split("/")[0]));
  // Hard links into media/ are fine (same files); symlinks must stay inside the root.
  return real === root || real.startsWith(root + path.sep) ? abs : null;
}

export type Entry = {
  name: string;
  rel: string;
  isDir: boolean;
  size: number;
  mtime: Date;
  type: FileType | "dir";
  /** Markdown: the title from its front matter or first heading. */
  title?: string;
  children?: number;
};

function mdTitle(abs: string) {
  try {
    const head = fs.readFileSync(abs, "utf8").slice(0, 1500);
    return /^title:\s*"?(.+?)"?\s*$/m.exec(head)?.[1] ?? /^#\s+(.+)$/m.exec(head)?.[1];
  } catch {
    return undefined;
  }
}

/** A folder's entries: folders first, then files newest first. */
export function listDir(rel: string): Entry[] | null {
  const dir = currentDataDir();
  if (!dir) return null;
  if (!rel) {
    return ROOTS.filter((r) => fs.existsSync(path.join(dir, r.key))).map((r) => {
      const st = fs.statSync(path.join(dir, r.key));
      return { name: r.label, rel: r.key, isDir: true, size: 0, mtime: st.mtime, type: "dir" as const, children: countVisible(path.join(dir, r.key)) };
    });
  }
  const abs = resolveBrowsable(rel);
  if (!abs || !fs.statSync(abs).isDirectory()) return null;
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => !d.name.startsWith("."))
    .map((d): Entry => {
      const childRel = `${rel}/${d.name}`;
      const p = path.join(abs, d.name);
      const st = fs.statSync(p);
      const isDir = st.isDirectory();
      return {
        name: d.name,
        rel: childRel,
        isDir,
        size: isDir ? 0 : st.size,
        mtime: st.mtime,
        type: isDir ? "dir" : fileType(d.name),
        title: !isDir && d.name.endsWith(".md") ? mdTitle(p) : undefined,
        children: isDir ? countVisible(p) : undefined,
      };
    })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || (a.isDir ? a.name.localeCompare(b.name) : b.mtime.getTime() - a.mtime.getTime()));
}

function countVisible(abs: string) {
  try {
    return fs.readdirSync(abs).filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
}

/** File names containing `q` anywhere under the roots (newest first). */
export function searchFiles(q: string, limit = 200): Entry[] {
  const dir = currentDataDir();
  const needle = q.trim().toLowerCase();
  if (!dir || !needle) return [];
  const out: Entry[] = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 6) return;
    for (const e of listDir(rel) ?? []) {
      if (e.isDir) walk(e.rel, depth + 1);
      else if (e.name.toLowerCase().includes(needle) || e.title?.toLowerCase().includes(needle)) out.push(e);
    }
  };
  for (const r of ROOTS) if (fs.existsSync(path.join(dir, r.key))) walk(r.key, 0);
  return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, limit);
}

/** A text file's contents for previewing (capped). */
export function readText(rel: string, max = 1_000_000) {
  const abs = resolveBrowsable(rel);
  if (!abs || !fs.statSync(abs).isFile()) return null;
  const buf = Buffer.alloc(Math.min(max, fs.statSync(abs).size));
  const fd = fs.openSync(abs, "r");
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return { text: buf.toString("utf8"), truncated: fs.statSync(abs).size > max };
}

export function fileStat(rel: string) {
  const abs = resolveBrowsable(rel);
  if (!abs) return null;
  const st = fs.statSync(abs);
  return { isDir: st.isDirectory(), size: st.size, mtime: st.mtime };
}
