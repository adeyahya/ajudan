import { and, eq, inArray, max } from "drizzle-orm";
import { db, schema } from "@/db";
import { runAgent } from "@/lib/claude";
import { logEvent } from "@/lib/events";
import type { JobPayloads } from "@/lib/jobs";
import { getLanguage, languageInstruction } from "@/lib/language";
import { businessWorkspace } from "@/lib/paths";
import { PausedError, runAbortController } from "../session";
import { UsageLimitError } from "@/lib/rest";
import { getRole, MANAGER_ROLE, ROLE_TEMPLATES } from "@/lib/roles";
import { defaultPersona, MAX_TEAM, mergeProposal, normalizeTeam, renderCurrentTeam, type CurrentTeammate } from "@/lib/team";
import { renderProfileMarkdown } from "@/lib/profile-markdown";
import type { BusinessProfile } from "@/lib/types";
import { TeamProposalSchema, type TeammateProposal, type TeamProposal } from "@/lib/types";

/**
 * Design (or redesign) the team from the business profile. The current team, with the
 * owner's edits, goes into the prompt so the designer builds on it: active teammates
 * are never removed, a re-proposed teammate keeps the owner's edits (src/lib/team.ts).
 */
export async function designTeam({ businessId }: JobPayloads["design_team"]) {
  const ac = runAbortController();
  try {
    const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
    if (!biz) throw new Error(`Business ${businessId} not found`);
    if (!biz.profile) throw new Error("Business profile is missing; finish the interview first");

    const roles = ROLE_TEMPLATES.map(
      (r) => `- key: ${r.key}\n  title: ${r.title}\n  summary: ${r.summary}\n  instructions: ${r.instructions}`,
    ).join("\n");

    // AI teammates the owner already has (working or reviewed); the manager and people on WhatsApp aren't designed.
    const current: CurrentTeammate[] = db
      .select()
      .from(schema.teammates)
      .where(
        and(
          eq(schema.teammates.businessId, businessId),
          inArray(schema.teammates.status, ["active", "proposed"]),
          eq(schema.teammates.kind, "ai"),
        ),
      )
      .all()
      .filter((t) => t.roleKey !== MANAGER_ROLE.key);
    const active = current.filter((t) => t.status === "active");
    const hasLead = active.some((t) => t.roleKey === "growth_lead");

    const currentBlock = current.length
      ? `
<current_team>
${renderCurrentTeam(current)}
</current_team>

The owner has already seen this team and may have edited it (names, freedom, schedules, briefs). Build on it instead of starting over: keep teammates that still fit (return them with the same name so their edits are kept), improve weak briefs, and only add or replace someone when the profile clearly calls for it. Teammates marked active are already working: never drop or rename them, and don't propose a duplicate with the same role unless the business needs two.
`
      : "";

    const res = await runAgent<TeamProposal>({
      prompt: `Design the AI team for this business.

<business_profile>
${renderProfileMarkdown(biz.profile, biz.language)}
</business_profile>

<role_templates>
${roles}
</role_templates>
${currentBlock}
Requirements:
- Propose ${active.length ? `up to ${MAX_TEAM} teammates in total (counting the active ones)` : "3-5 teammates"}. ${hasLead ? "The team already has a growth strategist." : 'Always include exactly one "growth_lead" (the growth strategist), who owns the strategy and the weekly plan; a manager is added automatically and hands out the work, so the strategist plans but never delegates.'} Pick the other roles that best serve this business's goals and the owner's stated team needs; do not add roles just to fill seats. Propose "operations_assistant" when the owner handles orders, stock, invoices or bookkeeping by hand, and "customer_support" when customers ask questions (for example on WhatsApp) that the owner answers today.
- roleKey must be one of the template keys above. Use the template title or a slightly more specific variant.
- name: a friendly, distinct first name per teammate.
- why: 1-2 sentences tied to this business's goals.
- persona: 3-6 sentences of business-specific instructions (products, customers, brand voice, channels, what to focus on, what to avoid). Do not repeat the generic template instructions.
- responsibilities: 3-5 concrete items. kpis: 2-4 measurable items tied to the goals.
- autonomy: "ask" by default; "draft" for anything customer-facing that is sensitive. Avoid "auto" unless the work is purely internal research.
- schedule: optionally a weekly 5-field cron expression (e.g. "0 9 * * 1" = Mondays 09:00) with a concrete schedulePrompt describing the recurring work; otherwise null for both. Give the growth strategist a weekly planning schedule (a plan for the week saved on the Work page; it never delegates).
- summary: 2-4 sentences for the owner explaining how this team will reach the goals${current.length ? " and what changed from the current team" : ""}.
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

    const picked = normalizeTeam(res.structured.teammates, { hasLead, defaultLead: () => defaultGrowthLead(biz.profile!) });
    const { insert, kept } = mergeProposal(current, picked);

    db.transaction((tx) => {
      // Only proposals are replaced; active teammates (and people on WhatsApp) stay.
      tx.delete(schema.teammates)
        .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "proposed")))
        .run();
      const top = tx
        .select({ m: max(schema.teammates.deskIndex) })
        .from(schema.teammates)
        .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
        .get();
      const base = (top?.m ?? -1) + 1;
      insert.forEach((t, i) => {
        const role = getRole(t.roleKey)!;
        tx.insert(schema.teammates)
          .values({
            businessId,
            name: t.name.trim() || role.title,
            roleKey: t.roleKey,
            title: t.title.trim() || role.title,
            color: role.color,
            persona: t.persona.trim() || defaultPersona(role, biz.profile!),
            why: t.why,
            responsibilities: t.responsibilities,
            kpis: t.kpis.length ? t.kpis : role.defaultKpis,
            autonomy: t.autonomy,
            schedule: t.schedule,
            schedulePrompt: t.schedule ? t.schedulePrompt : null,
            browserAccess: t.browserAccess,
            whatsappAccess: t.whatsappAccess,
            shellAccess: t.shellAccess,
            status: "proposed",
            deskIndex: base + i,
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
      message: `Proposed a team of ${insert.length}: ${insert.map((t) => `${t.name} (${t.title})`).join(", ")}${
        kept.length ? ` (keeping ${kept.map((t) => t.name).join(", ")})` : ""
      }`,
      data: { costUsd: res.costUsd },
    });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError(); // stays busy; reruns when reopened
    if (err instanceof UsageLimitError) throw err; // stays busy; reruns when the team wakes up
    const message = err instanceof Error ? err.message : String(err);
    db.update(schema.businesses).set({ busy: false }).where(eq(schema.businesses.id, businessId)).run();
    logEvent({ businessId, type: "team_error", message });
    throw err;
  }
}

function defaultGrowthLead(profile: BusinessProfile): TeammateProposal {
  const role = getRole("growth_lead")!;
  return {
    name: "Maya",
    roleKey: role.key,
    title: role.title,
    why: "Keeps the team's work aligned with your goals: a clear plan every week that you (and the manager) can act on.",
    persona: defaultPersona(role, profile),
    responsibilities: ["Turn the goals into a weekly plan with priorities", "Review last week's results against the goals", "Recommend what each channel should focus on next"],
    kpis: role.defaultKpis,
    autonomy: "ask",
    schedule: "0 9 * * 1",
    schedulePrompt: "Review last week's work against the goals and save this week's plan: priorities, what each teammate should work on, and what to measure. Don't assign tasks; the manager hands the work out.",
  };
}
