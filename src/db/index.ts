import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DATA_DIR, DB_PATH } from "@/lib/paths";
import * as schema from "./schema";

declare global {
  var __ajudanDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  // The web app and the worker are separate processes sharing this file.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

// Reuse one connection across Next.js dev hot reloads.
export const db = globalThis.__ajudanDb ?? (globalThis.__ajudanDb = createDb());
export { schema };
