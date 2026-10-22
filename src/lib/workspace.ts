import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Teammate } from "@/db/schema";
import type { BusinessProfile } from "@/lib/types";
import { slugify } from "@/lib/folders";
import { resolveWorkspace, teammatesRoot } from "@/lib/paths";
import { renderProfileMarkdown } from "@/lib/profile-markdown";
import { aboutMarkdown, ensureContextWorkspace, refreshAboutPage, writeTeamNotesFile } from "@/lib/context";

/** The shared notes file: a copy of the Context page of the owner's feedback (src/lib/context.ts). */
export const TEAM_NOTES = "TEAM.md";

/** teammates/TEAM.md, rendered from the "learned" Context page (seeded first if needed). Returns the path. */
export function ensureTeamNotes(businessId: string) {
  ensureContextWorkspace(businessId);
  writeTeamNotesFile(businessId);
  return path.join(teammatesRoot(), TEAM_NOTES);
}

/**
 * Create (or refresh) a teammate's working folder. Claude Code runs inside it:
 * BUSINESS.md (the Context workspace's About page, or the profile before there is one)
 * and TEAM.md (the owner's feedback page) are rewritten each time (teammates can only
 * read inside their folder); memory.md is the teammate's own long-term notes and is
 * never overwritten.
 */
export function initTeammateWorkspace(
  t: Pick<Teammate, "id" | "businessId" | "name" | "title"> & { workspaceDir?: string | null },
  profile: BusinessProfile,
  language: string,
) {
  const stored = t.workspaceDir || pickWorkspace(t);
  const dir = resolveWorkspace(stored);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".teammate-id"), t.id);
  fs.mkdirSync(path.join(dir, "work"), { recursive: true });
  const team = ensureTeamNotes(t.businessId);
  fs.writeFileSync(path.join(dir, "BUSINESS.md"), aboutMarkdown(t.businessId) ?? renderProfileMarkdown(profile, language));
  if (fs.existsSync(team)) fs.copyFileSync(team, path.join(dir, TEAM_NOTES));
  const memory = path.join(dir, "memory.md");
  if (!fs.existsSync(memory)) {
    fs.writeFileSync(
      memory,
      `# ${t.name}'s memory (${t.title})\n\nLong-term notes: decisions, what worked, what didn't, owner preferences.\n`,
    );
  }
  return stored;
}

/** Rewrite BUSINESS.md for every active teammate (after the profile or language changed). */
export function refreshWorkspaces(businessId: string, profile: BusinessProfile, language: string) {
  refreshAboutPage(businessId, profile, language);
  const active = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .all();
  for (const t of active) {
    const workspaceDir = initTeammateWorkspace(t, profile, language);
    if (workspaceDir !== t.workspaceDir) {
      db.update(schema.teammates).set({ workspaceDir }).where(eq(schema.teammates.id, t.id)).run();
    }
  }
}

/** A readable, unused folder for a new teammate: teammates/raka, teammates/raka-2… (relative). */
function pickWorkspace(t: Pick<Teammate, "id" | "name">) {
  const base = slugify(t.name);
  for (let i = 1; ; i++) {
    const rel = path.join("teammates", i === 1 ? base : `${base}-${i}`);
    const abs = path.join(teammatesRoot(), path.basename(rel));
    const owner = path.join(abs, ".teammate-id");
    if (!fs.existsSync(abs) || (fs.existsSync(owner) && fs.readFileSync(owner, "utf8").trim() === t.id)) return rel;
  }
}
