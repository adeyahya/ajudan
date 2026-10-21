import fs from "node:fs";
import path from "node:path";
import type { Teammate } from "@/db/schema";
import type { BusinessProfile } from "@/lib/types";
import { teammateWorkspace } from "@/lib/paths";

export function renderProfileMarkdown(p: BusinessProfile) {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none yet)");
  return `# ${p.name}

${p.website ? `Website: ${p.website}\n\n` : ""}**${p.oneLiner}**

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

/**
 * Create (or refresh) a teammate's working folder. Claude Code runs inside it:
 * BUSINESS.md is rewritten from the profile each time; memory.md is the teammate's
 * own long-term notes and is never overwritten.
 */
export function initTeammateWorkspace(t: Pick<Teammate, "id" | "businessId" | "name" | "title">, profile: BusinessProfile) {
  const dir = teammateWorkspace(t.businessId, t.id);
  fs.mkdirSync(path.join(dir, "work"), { recursive: true });
  fs.writeFileSync(path.join(dir, "BUSINESS.md"), renderProfileMarkdown(profile));
  const memory = path.join(dir, "memory.md");
  if (!fs.existsSync(memory)) {
    fs.writeFileSync(
      memory,
      `# ${t.name}'s memory (${t.title})\n\nLong-term notes: decisions, what worked, what didn't, owner preferences.\n`,
    );
  }
  return dir;
}
