import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

// runMigrations reads $AJUDAN_MIGRATIONS (default drizzle/) at import time, and the
// journal on every call. A private copy of drizzle/ lets each test add migrations.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-migrate-"));
const migrations = path.join(tmp, "drizzle");
fs.cpSync(path.resolve("drizzle"), migrations, { recursive: true });
process.env.AJUDAN_MIGRATIONS = migrations;
const { runMigrations } = await import("@/lib/migrate");

const journalPath = path.join(migrations, "meta", "_journal.json");
type Journal = { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
const readJournal = () => JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;
const baseJournal = readJournal();
let nextWhen = Math.max(...baseJournal.entries.map((e) => e.when)) + 1;

/** Append a migration to the private copy. */
function addMigration(tag: string, sql: string) {
  const journal = readJournal();
  const idx = journal.entries.length;
  const name = `${String(idx).padStart(4, "0")}_${tag}`;
  fs.writeFileSync(path.join(migrations, `${name}.sql`), sql);
  journal.entries.push({ idx, version: "6", when: nextWhen++, tag: name, breakpoints: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
}

function resetMigrations() {
  for (const f of fs.readdirSync(migrations)) if (f.endsWith(".sql") && !baseJournal.entries.some((e) => `${e.tag}.sql` === f)) fs.rmSync(path.join(migrations, f));
  fs.writeFileSync(journalPath, JSON.stringify(baseJournal, null, 2));
}

const newDir = (name: string) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d);
  return d;
};
const open = (dir: string) => new Database(path.join(dir, "ajudan.db"));
const count = (dir: string, table: string) => {
  const s = open(dir);
  try {
    return (s.prepare(`select count(*) as n from "${table}"`).get() as { n: number }).n;
  } finally {
    s.close();
  }
};
const applied = (dir: string) => count(dir, "__drizzle_migrations");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("runMigrations", () => {
  it("creates a fresh database with every migration applied and no backup", () => {
    const dir = newDir("fresh");
    const log: string[] = [];
    runMigrations(dir, (m) => log.push(m));
    expect(applied(dir)).toBe(baseJournal.entries.length);
    expect(count(dir, "businesses")).toBe(0);
    expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
    expect(log.join("\n")).toMatch(/applied \d+ migration/);
    expect(log.join("\n")).not.toMatch(/backup/);
  });

  it("is a no-op when up to date", () => {
    const dir = newDir("uptodate");
    runMigrations(dir);
    const log: string[] = [];
    runMigrations(dir, (m) => log.push(m));
    expect(log).toEqual(["[db] up to date"]);
    expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
  });

  it("creates the folder if missing", () => {
    const dir = path.join(tmp, "nested", "deeper");
    runMigrations(dir);
    expect(fs.existsSync(path.join(dir, "ajudan.db"))).toBe(true);
  });

  it("backs up before applying a new migration and keeps the rows", () => {
    const dir = newDir("harmless");
    runMigrations(dir);
    const s = open(dir);
    s.prepare("insert into businesses (id, name) values ('b1', 'Test')").run();
    s.close();
    try {
      addMigration("harmless", "CREATE TABLE `extra` (`id` text PRIMARY KEY NOT NULL);");
      const log: string[] = [];
      runMigrations(dir, (m) => log.push(m));
      expect(applied(dir)).toBe(baseJournal.entries.length + 1);
      expect(count(dir, "businesses")).toBe(1);
      expect(count(dir, "extra")).toBe(0);
      const backups = fs.readdirSync(path.join(dir, "backups"));
      expect(backups).toHaveLength(1);
      expect(backups[0]).toMatch(/^ajudan-.*\.db$/);
      expect(log.some((l) => l.includes(`backup: ${path.join(dir, "backups", backups[0])}`))).toBe(true);
      // The backup is a complete copy of the database before the migration.
      const b = new Database(path.join(dir, "backups", backups[0]), { readonly: true });
      expect((b.prepare("select count(*) as n from businesses").get() as { n: number }).n).toBe(1);
      expect(b.prepare("select 1 from sqlite_master where name='extra'").get()).toBeUndefined();
      b.close();
    } finally {
      resetMigrations();
    }
  });

  it("refuses to finish when a migration loses rows, naming the backup", () => {
    const dir = newDir("lossy");
    runMigrations(dir);
    const s = open(dir);
    s.prepare("insert into businesses (id, name) values ('b1', 'Test'), ('b2', 'Other')").run();
    s.close();
    try {
      addMigration("lossy", "DELETE FROM `businesses`;");
      let err: Error | undefined;
      try {
        runMigrations(dir);
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toMatch(/Migration lost data/);
      expect(err!.message).toMatch(/businesses: 2 → 0 rows/);
      const backup = /cp "([^"]+)"/.exec(err!.message)?.[1];
      expect(backup).toBeDefined();
      expect(fs.existsSync(backup!)).toBe(true);
      const b = new Database(backup!, { readonly: true });
      expect((b.prepare("select count(*) as n from businesses").get() as { n: number }).n).toBe(2);
      b.close();
      // The restore command in the message points at this folder's database.
      expect(err!.message).toContain(`"${path.join(dir, "ajudan.db")}"`);
    } finally {
      resetMigrations();
    }
  });

  it("refuses to finish when a migration breaks foreign keys", () => {
    const dir = newDir("broken-fk");
    runMigrations(dir);
    const s = open(dir);
    s.prepare("insert into businesses (id, name) values ('b1', 'Test')").run();
    s.close();
    try {
      // Foreign keys are off during the migration, so this orphan row gets in; the check after must catch it.
      addMigration("orphan", "INSERT INTO `teammates` (`id`, `business_id`, `name`, `role_key`, `title`) VALUES ('t1', 'missing', 'X', 'copywriter', 'X');");
      expect(() => runMigrations(dir)).toThrow(/foreign key violations/);
    } finally {
      resetMigrations();
    }
  });

  it("baselines a database made by drizzle-kit push (tables but no tracking)", () => {
    const dir = newDir("baseline");
    // Build the 0000_init schema by hand: run only the first migration's statements.
    const init = fs.readFileSync(path.join(migrations, `${baseJournal.entries[0].tag}.sql`), "utf8");
    const s = open(dir);
    for (const stmt of init.split("--> statement-breakpoint")) if (stmt.trim()) s.exec(stmt);
    s.prepare("insert into businesses (id, name) values ('b1', 'Test')").run();
    s.close();
    const log: string[] = [];
    runMigrations(dir, (m) => log.push(m));
    expect(log[0]).toBe("[db] existing database baselined at 0000");
    expect(applied(dir)).toBe(baseJournal.entries.length);
    expect(count(dir, "businesses")).toBe(1);
    expect(fs.readdirSync(path.join(dir, "backups"))).toHaveLength(1);
  });
});
