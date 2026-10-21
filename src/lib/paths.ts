import path from "node:path";
import { readConfig } from "@/lib/folders";

/**
 * Where the open business folder is (see src/lib/folders.ts):
 *   1. AJUDAN_DATA_DIR, if set (tests, scripts): always that folder;
 *   2. the worker's pinned folder (it only switches when it's safe, see worker/index.ts);
 *   3. ~/.ajudan/config.json → activeFolder (what the web app follows).
 */
let pinned: string | null | undefined;

export function pinDataDir(dir: string | null) {
  pinned = dir;
}

/** The open business folder, or null when none is open. */
export function currentDataDir(): string | null {
  if (process.env.AJUDAN_DATA_DIR) return path.resolve(process.env.AJUDAN_DATA_DIR);
  if (pinned !== undefined) return pinned;
  return readConfig().activeFolder;
}

export class NoFolderOpenError extends Error {
  constructor() {
    super("No business folder is open. Pick or create one on the home page.");
  }
}

export function dataDir(): string {
  const d = currentDataDir();
  if (!d) throw new NoFolderOpenError();
  return d;
}

export const dbPath = (dir = dataDir()) => path.join(dir, "ajudan.db");

/** Teammate folders are stored relative to the business folder so it can be moved. */
export function teammatesRoot() {
  return path.join(dataDir(), "teammates");
}

/** Resolve a teammate's stored workspace (relative, or absolute from older versions). */
export function resolveWorkspace(stored: string) {
  return path.isAbsolute(stored) ? stored : path.join(dataDir(), stored);
}

/** Scratch folder for the onboarding interviewer and team designer. */
export function businessWorkspace() {
  return path.join(dataDir(), "interview");
}

/** Every deliverable is also written here as a markdown file. */
export function workDir() {
  return path.join(dataDir(), "work");
}

export function backupsDir(dir = dataDir()) {
  return path.join(dir, "backups");
}
