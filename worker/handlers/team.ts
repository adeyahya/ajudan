import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { runAgent } from "@/lib/claude";
import { logEvent } from "@/lib/events";
import type { JobPayloads } from "@/lib/jobs";
import { getLanguage, languageInstruction } from "@/lib/language";
import { validCron } from "@/lib/onboarding/schedule";
import { businessWorkspace } from "@/lib/paths";
import { PausedError, runAbortController } from "../session";
import { getRole, ROLE_TEMPLATES } from "@/lib/roles";
import { renderProfileMarkdown } from "@/lib/workspace";
import { TeamProposalSchema, type TeammateProposal, type TeamProposal } from "@/lib/types";

const MAX_TEAM = 5;

export async function designTeam({ businessId }: JobPayloads["design_team"]) {
  const ac = runAbortController();
  try {
    const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
    if (!biz) throw new Error(`Business ${businessId} not found`);
    if (!biz.profile) throw new Error("Business profile is missing; finish the interview first");

    const roles = ROLE_TEMPLATES.map(
      (r) => `- key: ${r.key}\n  title: ${r.title}\n  summary: ${r.summary}\n  instructions: ${r.instructions}`,
    ).join("\n");

    const res = await runAgent<TeamProposal>({
      prompt: `Design the AI team for this business.

<business_profile>
${renderProfileMarkdown(biz.profile, biz.language)}
</business_profile>

<role_templates>
${roles}
</role_templates>

Requirements:
- Propose 3-5 teammates. Always include exactly one "growth_lead" who coordinates the others. Pick the other roles that best serve this business's goals and the owner's stated team needs; do not add roles just to fill seats.
- roleKey must be one of the template keys above. Use the template title or a slightly more specific variant.
- name: a friendly, distinct first name per teammate.
- why: 1-2 sentences tied to this business's goals.
- persona: 3-6 sentences of business-specific instructions (products, customers, brand voice, channels, what to focus on, what to avoid). Do not repeat the generic template instructions.
- responsibilities: 3-5 concrete items. kpis: 2-4 measurable items tied to the goals.
- autonomy: "ask" by default; "draft" for anything customer-facing that is sensitive. Avoid "auto" unless the work is purely internal research.
- schedule: optionally a weekly 5-field cron expression (e.g. "0 9 * * 1" = Mondays 09:00) with a concrete schedulePrompt describing the recurring work; otherwise null for both. Give the growth lead a weekly planning schedule.
- summary: 2-4 sentences for the owner explaining how this team will reach the goals.
- Language: write title, why, persona, responsibilities, kpis, schedulePrompt and summary in ${getLanguage(biz.language).nativeLabel}. Names may be any fitting first names. roleKey, autonomy and schedule stay as specified.`,
      systemPrompt: `You are Ajudan's team designer. You design small, focused teams of AI teammates for small businesses, picking from a fixed library of role templates and customizing them to the business.\n\n${languageInstruction(biz.language)}`,
      cwd: businessWorkspace(),
      tools: [],
      outputSchema: TeamProposalSchema,
      maxTurns: 4,
      maxBudgetUsd: 1,
      abortController: ac,
    });
    if (!res.ok || !res.structured) throw new Error(res.error ?? "No team proposal returned");

    const picked = normalizeTeam(res.structured.teammates);

    db.transaction((tx) => {
      tx.delete(schema.teammates)
        .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "proposed")))
        .run();
      picked.forEach((t, i) => {
        const role = getRole(t.roleKey)!;
        tx.insert(schema.teammates)
          .values({
            businessId,
            name: t.name.trim() || role.title,
            roleKey: t.roleKey,
            title: t.title.trim() || role.title,
            color: role.color,
            persona: t.persona,
            why: t.why,
            responsibilities: t.responsibilities,
            kpis: t.kpis.length ? t.kpis : role.defaultKpis,
            autonomy: t.autonomy ?? "ask",
            schedule: t.schedule,
            schedulePrompt: t.schedule ? t.schedulePrompt : null,
            status: "proposed",
            deskIndex: i,
          })
          .run();
      });
      tx.update(schema.businesses)
        .set({ teamSummary: res.structured!.summary, status: "team_proposed", busy: false })
        .where(eq(schema.businesses.id, businessId))
        .run();
    });

    logEvent({
      businessId,
      type: "team_proposed",
      message: `Proposed a team of ${picked.length}: ${picked.map((t) => `${t.name} (${t.title})`).join(", ")}`,
      data: { costUsd: res.costUsd },
    });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError(); // stays busy; reruns when reopened
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.businesses).set({ busy: false }).where(eq(schema.businesses.id, businessId)).run();
    logEvent({ businessId, type: "team_error", message });
    throw err;
  }
}

/** Drop unknown roles, guarantee a growth lead, cap the size, validate schedules. */
function normalizeTeam(proposed: TeammateProposal[]): TeammateProposal[] {
  let team = proposed.filter((t) => getRole(t.roleKey));
  const leads = team.filter((t) => t.roleKey === "growth_lead");
  team = team.filter((t) => t.roleKey !== "growth_lead");
  const lead: TeammateProposal = leads[0] ?? defaultGrowthLead();
  team = [lead, ...team].slice(0, MAX_TEAM);
  return team.map((t) => {
    const schedule = validCron(t.schedule);
    return {
      ...t,
      autonomy: t.autonomy === "draft" || t.autonomy === "auto" ? t.autonomy : "ask",
      schedule,
      schedulePrompt: schedule ? t.schedulePrompt?.trim() || null : null,
    };
  });
}

function defaultGrowthLead(): TeammateProposal {
  const role = getRole("growth_lead")!;
  return {
    name: "Maya",
    roleKey: role.key,
    title: role.title,
    why: "Coordinates the team and keeps the work aligned with your goals.",
    persona: "",
    responsibilities: ["Turn the goals into a weekly plan", "Delegate tasks to the team", "Report progress to the owner"],
    kpis: role.defaultKpis,
    autonomy: "ask",
    schedule: "0 9 * * 1",
    schedulePrompt: "Review last week's work, write a short progress report and plan this week's tasks for the team.",
  };
}
