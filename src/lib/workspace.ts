import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Teammate } from "@/db/schema";
import type { BusinessProfile } from "@/lib/types";
import { languageName } from "@/lib/language";
import { slugify } from "@/lib/folders";
import { resolveWorkspace, teammatesRoot } from "@/lib/paths";

export function renderProfileMarkdown(p: BusinessProfile, language: string) {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none yet)");
  return `# ${p.name}

${p.website ? `Website: ${p.website}\n\n` : ""}Working language: ${languageName(language)}. Write everything for this business in this language.

**${p.oneLiner}**

${p.description}

## Products
${list(p.products)}

## Target customers
${list(p.targetCustomers)}

## Channels
${list(p.channels)}

## Brand voice
${p.brandVoice}

## Competitors
${list(p.competitors)}

## Goals (next ~90 days)
${p.goals.map((g) => `- ${g.goal} — measured by ${g.metric}, target: ${g.target}`).join("\n") || "- (none yet)"}

## Constraints
${list(p.constraints)}

## What the owner wants from the team
${list(p.teamNeeds)}
`;
}

/** The shared notes file: the owner's feedback and preferences for the whole team (src/lib/feedback.ts). */
export const TEAM_NOTES = "TEAM.md";

/** teammates/TEAM.md, created with its header if missing. Returns the path. */
export function ensureTeamNotes(businessName: string) {
  const root = teammatesRoot();
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, TEAM_NOTES);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      `# Team notes for ${businessName}

What the owner told the team about its work: shared by every teammate and read before each task, next to BUSINESS.md. Newest at the bottom. Ajudan writes it from the owner's feedback on the Work and Approvals pages; the owner can edit it too.

## Owner feedback and preferences
`,
    );
  }
  return file;
}

/**
 * Create (or refresh) a teammate's working folder. Claude Code runs inside it:
 * BUSINESS.md is rewritten from the profile and TEAM.md copied from teammates/TEAM.md
 * each time (teammates can only read inside their folder); memory.md is the teammate's
 * own long-term notes and is never overwritten.
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
  fs.writeFileSync(path.join(dir, "BUSINESS.md"), renderProfileMarkdown(profile, language));
  fs.copyFileSync(ensureTeamNotes(profile.name), path.join(dir, TEAM_NOTES));
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
