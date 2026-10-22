import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * One business = one folder. Everything about it lives inside:
 *
 *   ~/Ajudan/Orucraft/
 *     ajudan.db        team, tasks, approvals, history
 *     teammates/raka/  memory.md, notes, drafts
 *     work/            every deliverable as a .md file
 *     browser/         the logged-in Chrome profile
 *     backups/         database backups taken before migrations
 *
 * Only one folder is open at a time (~/.ajudan/config.json). Teammates of other
 * folders are paused until you switch back.
 */

export const AJUDAN_HOME = path.resolve(process.env.AJUDAN_HOME ?? path.join(os.homedir(), "Ajudan"));
const CONFIG_DIR = path.join(os.homedir(), ".ajudan");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export type AjudanConfig = { activeFolder: string | null; recent: string[] };

let cache: { mtimeMs: number; config: AjudanConfig } | undefined;

export function readConfig(): AjudanConfig {
  try {
    const { mtimeMs } = fs.statSync(CONFIG_PATH);
    if (cache?.mtimeMs === mtimeMs) return cache.config;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<AjudanConfig>;
    const config = { activeFolder: raw.activeFolder ?? null, recent: raw.recent ?? [] };
    cache = { mtimeMs, config };
    return config;
  } catch {
    return { activeFolder: null, recent: [] };
  }
}

function writeConfig(config: AjudanConfig) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  cache = undefined;
}

/** Make `dir` the open business folder (and remember it in the recent list). */
export function setActiveFolder(dir: string) {
  const abs = path.resolve(dir);
  const c = readConfig();
  writeConfig({ activeFolder: abs, recent: [abs, ...c.recent.filter((r) => r !== abs)].slice(0, 20) });
}

/** Add `dir` to the recent list without opening it (desktop app windows). */
export function rememberFolder(dir: string) {
  const abs = path.resolve(dir);
  const c = readConfig();
  writeConfig({ activeFolder: c.activeFolder, recent: [abs, ...c.recent.filter((r) => r !== abs)].slice(0, 20) });
}

export function forgetFolder(dir: string) {
  const abs = path.resolve(dir);
  const c = readConfig();
  writeConfig({
    activeFolder: c.activeFolder === abs ? null : c.activeFolder,
    recent: c.recent.filter((r) => r !== abs),
  });
}

export function isBusinessFolder(dir: string) {
  return fs.existsSync(path.join(dir, "ajudan.db"));
}

/** "Orucraft Store!" → "orucraft-store" */
export function slugify(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business"
  );
}

/** Suggest a new, unused folder for a business name, e.g. ~/Ajudan/Orucraft. */
export function suggestFolder(name: string) {
  const base = name.trim().replace(/[/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "My Business";
  let dir = path.join(AJUDAN_HOME, base);
  for (let i = 2; fs.existsSync(dir) && fs.readdirSync(dir).length; i++) dir = path.join(AJUDAN_HOME, `${base} ${i}`);
  return dir;
}

export type FolderInfo = {
  dir: string;
  exists: boolean;
  name: string;
  website: string | null;
  status: string | null;
  businessId: string | null;
  teammates: number;
};

/** Peek into a business folder without opening it in the app. */
export function folderInfo(dir: string): FolderInfo {
  const fallback = { dir, name: path.basename(dir), website: null, status: null, businessId: null, teammates: 0 };
  if (!isBusinessFolder(dir)) return { ...fallback, exists: fs.existsSync(dir) };
  let db: Database.Database | undefined;
  try {
    db = new Database(path.join(dir, "ajudan.db"), { readonly: true, fileMustExist: true });
    const b = db.prepare("select id, name, website, status from businesses order by created_at limit 1").get() as
      | { id: string; name: string; website: string | null; status: string }
      | undefined;
    const t = db.prepare("select count(*) as n from teammates where status = 'active'").get() as { n: number };
    return {
      dir,
      exists: true,
      name: b?.name ?? path.basename(dir),
      website: b?.website ?? null,
      status: b?.status ?? null,
      businessId: b?.id ?? null,
      teammates: t.n,
    };
  } catch {
    return { ...fallback, exists: true };
  } finally {
    db?.close();
  }
}

/** Business folders to show on the home page: recent ones plus any found in ~/Ajudan. */
export function knownFolders(): FolderInfo[] {
  const dirs = new Set(readConfig().recent);
  try {
    for (const e of fs.readdirSync(AJUDAN_HOME, { withFileTypes: true })) {
      const d = path.join(AJUDAN_HOME, e.name);
      if (e.isDirectory() && isBusinessFolder(d)) dirs.add(d);
    }
  } catch {
    // ~/Ajudan doesn't exist yet
  }
  return [...dirs].map(folderInfo);
}
