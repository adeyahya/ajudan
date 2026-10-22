import type { BusinessProfile } from "@/lib/types";
import { languageName } from "@/lib/language";

/** The business profile as markdown: BUSINESS.md, and the first "About" page of the Context workspace. */
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
