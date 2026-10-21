import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runMigrations } from "@/lib/migrate";
import { dataDir, dbPath } from "@/lib/paths";
import * as schema from "./schema";

function createDb(dir: string) {
  // Creates the folder's database or brings it up to date (with a backup first).
  runMigrations(dir);
  const sqlite = new Database(dbPath(dir));
  // The web app and the worker are separate processes sharing this file.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

type Db = ReturnType<typeof createDb>;

declare global {
  // One connection per business folder, reused across Next.js dev hot reloads.
  var __ajudanDbs: Map<string, Db> | undefined;
}
const dbs = (globalThis.__ajudanDbs ??= new Map<string, Db>());

/** The open business folder's database. Throws NoFolderOpenError if none is open. */
export function getDb(dir = dataDir()): Db {
  let d = dbs.get(dir);
  if (!d) dbs.set(dir, (d = createDb(dir)));
  return d;
}

/**
 * `db` always means "the open business folder's database". It resolves on every
 * access, so switching folders (src/lib/folders.ts) needs no restart.
 */
export const db = new Proxy({} as Db, {
  get(_, prop) {
    const real = getDb();
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export { schema };
