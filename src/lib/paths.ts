import path from "node:path";

/** Root for the SQLite file and teammate workspaces. Override with AJUDAN_DATA_DIR. */
export const DATA_DIR = path.resolve(process.env.AJUDAN_DATA_DIR ?? "data");
export const DB_PATH = path.join(DATA_DIR, "ajudan.db");

/** Each teammate gets its own folder that Claude Code runs in (memory.md, drafts, notes). */
export function teammateWorkspace(businessId: string, teammateId: string) {
  return path.join(DATA_DIR, "workspaces", businessId, teammateId);
}

/** Scratch folder for the onboarding interviewer and team designer. */
export function businessWorkspace(businessId: string) {
  return path.join(DATA_DIR, "workspaces", businessId, "_onboarding");
}
