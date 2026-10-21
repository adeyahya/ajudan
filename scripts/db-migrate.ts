/**
 * Apply drizzle/ migrations to $AJUDAN_DATA_DIR/ajudan.db, safely.
 *
 * Why not `drizzle-kit push`: on SQLite it rebuilds a table to change it, and with
 * foreign keys on, dropping the old table cascade-deletes every row that references
 * it (this wiped teammates and tasks once). Here we:
 *   1. take a full backup (WAL included) to data/backups/,
 *   2. turn foreign keys OFF on the connection before migrating,
 *   3. refuse to finish if any table lost rows (restore from the backup).
 *
 * Schema change workflow: edit src/db/schema.ts → `pnpm db:generate` → `pnpm db:migrate`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const DATA_DIR = path.resolve(process.env.AJUDAN_DATA_DIR ?? "data");
const DB_PATH = path.join(DATA_DIR, "ajudan.db");
const MIGRATIONS = path.resolve("drizzle");

function tableCounts(sqlite: Database.Database) {
  const tables = sqlite
    .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [name, (sqlite.prepare(`select count(*) as n from "${name}"`).get() as { n: number }).n]),
  );
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fresh = !fs.existsSync(DB_PATH);
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");

  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  const hasTracking = !!sqlite.prepare("select 1 from sqlite_master where name='__drizzle_migrations'").get();
  const hasTables = !!sqlite.prepare("select 1 from sqlite_master where name='businesses'").get();

  // A database created by the old `drizzle-kit push` already matches 0000_init: record it as applied.
  if (!hasTracking && hasTables && migrations.length) {
    sqlite.exec(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    );
    sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)").run(migrations[0].hash, migrations[0].folderMillis);
    console.log("[db] existing database baselined at", path.basename(MIGRATIONS), "0000");
  }

  const tracked = !!sqlite.prepare("select 1 from sqlite_master where name='__drizzle_migrations'").get();
  const applied = new Set(
    tracked
      ? (sqlite.prepare("select created_at from __drizzle_migrations").all() as { created_at: number }[]).map((r) =>
          Number(r.created_at),
        )
      : [],
  );
  const pending = migrations.filter((m) => !applied.has(m.folderMillis));
  if (!pending.length && !fresh) {
    console.log("[db] up to date");
    return;
  }

  let backup: string | undefined;
  let before: Record<string, number> = {};
  if (!fresh && hasTables) {
    const dir = path.join(DATA_DIR, "backups");
    fs.mkdirSync(dir, { recursive: true });
    backup = path.join(dir, `ajudan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    await sqlite.backup(backup);
    before = tableCounts(sqlite);
    console.log("[db] backup:", backup);
  }

  sqlite.pragma("foreign_keys = OFF");
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
  const broken = sqlite.pragma("foreign_key_check") as unknown[];
  sqlite.pragma("foreign_keys = ON");

  const after = tableCounts(sqlite);
  const lost = Object.entries(before).filter(([t, n]) => (after[t] ?? 0) < n);
  if (lost.length || broken.length) {
    console.error("\n[db] MIGRATION LOST DATA OR BROKE REFERENCES. Stop the app and restore:");
    for (const [t, n] of lost) console.error(`  ${t}: ${n} → ${after[t] ?? 0} rows`);
    if (broken.length) console.error(`  ${broken.length} foreign key violations`);
    console.error(`  cp "${backup}" "${DB_PATH}" && rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"\n`);
    process.exit(1);
  }
  console.log(`[db] applied ${pending.length} migration(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
