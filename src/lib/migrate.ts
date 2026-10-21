import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

/*
 * Safe schema migrations for a business folder's ajudan.db.
 *
 * Why not `drizzle-kit push`: on SQLite it rebuilds a table to change it, and with
 * foreign keys on, dropping the old table cascade-deletes every row that references
 * it (this wiped teammates and tasks once). Here we:
 *   1. take a full backup (WAL included) to <folder>/backups/,
 *   2. turn foreign keys OFF on the connection before migrating,
 *   3. refuse to finish if any table lost rows.
 *
 * Schema change workflow: edit src/db/schema.ts → `pnpm db:generate` → `pnpm db:migrate`.
 */

const MIGRATIONS = path.resolve(process.env.AJUDAN_MIGRATIONS ?? "drizzle");

function tableCounts(sqlite: Database.Database) {
  const tables = sqlite
    .prepare(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (
        sqlite.prepare(`select count(*) as n from "${name}"`).get() as {
          n: number;
        }
      ).n,
    ]),
  );
}

/**
 * Bring `dir`'s ajudan.db up to date with drizzle/ migrations (creates it if new).
 * Synchronous on purpose: the DB layer runs it the first time it opens a folder.
 * Throws if a migration lost rows; the backup path is in the message.
 */
export function runMigrations(
  dir: string,
  log: (msg: string) => void = () => {},
) {
  fs.mkdirSync(dir, { recursive: true });
  const DB_PATH = path.join(dir, "ajudan.db");
  const fresh = !fs.existsSync(DB_PATH);
  const sqlite = new Database(DB_PATH);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");

    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const hasTracking = !!sqlite
      .prepare("select 1 from sqlite_master where name='__drizzle_migrations'")
      .get();
    const hasTables = !!sqlite
      .prepare("select 1 from sqlite_master where name='businesses'")
      .get();

    // A database created by the old `drizzle-kit push` already matches 0000_init: record it as applied.
    if (!hasTracking && hasTables && migrations.length) {
      sqlite.exec(
        "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
      );
      sqlite
        .prepare(
          "insert into __drizzle_migrations (hash, created_at) values (?, ?)",
        )
        .run(migrations[0].hash, migrations[0].folderMillis);
      log("[db] existing database baselined at 0000");
    }

    const tracked = !!sqlite
      .prepare("select 1 from sqlite_master where name='__drizzle_migrations'")
      .get();
    const applied = new Set(
      tracked
        ? (
            sqlite
              .prepare("select created_at from __drizzle_migrations")
              .all() as { created_at: number }[]
          ).map((r) => Number(r.created_at))
        : [],
    );
    const pending = migrations.filter((m) => !applied.has(m.folderMillis));
    if (!pending.length && !fresh) {
      log("[db] up to date");
      return;
    }

    let backup: string | undefined;
    let before: Record<string, number> = {};
    if (!fresh && hasTables) {
      const bdir = path.join(dir, "backups");
      fs.mkdirSync(bdir, { recursive: true });
      backup = path.join(
        bdir,
        `ajudan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
      );
      sqlite.prepare("VACUUM INTO ?").run(backup); // consistent copy, WAL included
      before = tableCounts(sqlite);
      log(`[db] backup: ${backup}`);
    }

    sqlite.pragma("foreign_keys = OFF");
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });
    const broken = sqlite.pragma("foreign_key_check") as unknown[];
    sqlite.pragma("foreign_keys = ON");

    const after = tableCounts(sqlite);
    const lost = Object.entries(before).filter(([t, n]) => (after[t] ?? 0) < n);
    if (lost.length || broken.length) {
      throw new Error(
        [
          "Migration lost data or broke references. Stop the app and restore:",
          ...lost.map(([t, n]) => `  ${t}: ${n} → ${after[t] ?? 0} rows`),
          ...(broken.length
            ? [`  ${broken.length} foreign key violations`]
            : []),
          `  cp "${backup}" "${DB_PATH}" && rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"`,
        ].join("\n"),
      );
    }
    log(`[db] applied ${pending.length} migration(s)`);
  } finally {
    sqlite.close();
  }
}
