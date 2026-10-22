import type { Autonomy, Teammate } from "@/db/schema";
import { validCron } from "@/lib/onboarding/schedule";
import { getRole, type RoleTemplate } from "@/lib/roles";
import type { BusinessProfile, TeammateProposal } from "@/lib/types";

/** The designer proposes at most this many teammates per round. */
export const MAX_TEAM = 5;

/** "one per line" fields: split on newlines or semicolons, strip bullets, cap the count. */
export function parseLines(text: string, max = 8): string[] {
  return text
    .split(/\n|;/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * A usable brief for a teammate the owner adds by hand without describing it: what
 * the business is, who it serves, the voice, and what the owner wants from the team.
 * The role template's own instructions are added separately (worker/handlers/task.ts).
 */
export function defaultPersona(role: Pick<RoleTemplate, "title">, profile: BusinessProfile): string {
  const parts = [`You are the ${role.title} for ${profile.name}: ${profile.oneLiner.replace(/\.$/, "")}.`];
  if (profile.products.length) parts.push(`Products: ${profile.products.slice(0, 4).join(", ")}.`);
  if (profile.targetCustomers.length) parts.push(`Customers: ${profile.targetCustomers.slice(0, 3).join(", ")}.`);
  if (profile.channels.length) parts.push(`Channels: ${profile.channels.slice(0, 4).join(", ")}.`);
  if (profile.brandVoice.trim()) parts.push(`Brand voice: ${profile.brandVoice.trim().replace(/\.$/, "")}.`);
  if (profile.teamNeeds.length) parts.push(`The owner wants the team to: ${profile.teamNeeds.slice(0, 3).join("; ")}.`);
  if (profile.constraints.length) parts.push(`Keep in mind: ${profile.constraints.slice(0, 3).join("; ")}.`);
  return parts.join(" ");
}

export type CurrentTeammate = Pick<
  Teammate,
  | "id"
  | "name"
  | "roleKey"
  | "title"
  | "persona"
  | "responsibilities"
  | "kpis"
  | "autonomy"
  | "schedule"
  | "schedulePrompt"
  | "status"
  | "browserAccess"
  | "whatsappAccess"
  | "shellAccess"
>;

/** The current team as the designer sees it: what's there, which ones can't be removed. */
export function renderCurrentTeam(current: CurrentTeammate[]): string {
  return current
    .map(
      (t) =>
        `- name: ${t.name}\n  roleKey: ${t.roleKey}\n  title: ${t.title}\n  status: ${t.status === "active" ? "active (already working; cannot be removed or renamed)" : "proposed (the owner has reviewed it)"}\n  autonomy: ${t.autonomy}${t.schedule ? `\n  schedule: ${t.schedule} — ${t.schedulePrompt ?? ""}` : ""}\n  persona: ${t.persona || "(none)"}\n  responsibilities: ${t.responsibilities.join("; ") || "(none)"}\n  kpis: ${t.kpis.join("; ") || "(none)"}`,
    )
    .join("\n");
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Drop unknown roles, guarantee one growth lead (unless the team has one), cap the size, validate schedules. */
export function normalizeTeam(proposed: TeammateProposal[], opts: { hasLead?: boolean; defaultLead: () => TeammateProposal }): TeammateProposal[] {
  let team = proposed.filter((t) => getRole(t.roleKey) && t.roleKey !== "manager");
  const leads = team.filter((t) => t.roleKey === "growth_lead");
  team = team.filter((t) => t.roleKey !== "growth_lead");
  const lead = leads[0] ?? (opts.hasLead ? null : opts.defaultLead());
  team = [...(lead && !opts.hasLead ? [lead] : []), ...team].slice(0, MAX_TEAM);
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

export type MergedProposal = TeammateProposal & {
  autonomy: Autonomy;
  browserAccess: boolean;
  whatsappAccess: boolean;
  shellAccess: boolean;
};

/**
 * Fit a new proposal around the current team. Active teammates are never touched: a
 * proposal with an active teammate's name is dropped (it's them). A proposal that
 * matches a previously proposed teammate keeps the owner's edits to it (name, autonomy,
 * schedule, abilities). Everything else is a new proposal.
 */
export function mergeProposal(current: CurrentTeammate[], proposed: TeammateProposal[]): { insert: MergedProposal[]; kept: CurrentTeammate[] } {
  const active = current.filter((t) => t.status === "active");
  const previous = current.filter((t) => t.status === "proposed");
  const insert: MergedProposal[] = [];
  const kept: CurrentTeammate[] = [];
  for (const p of proposed) {
    const stays = active.find((t) => sameName(t.name, p.name));
    if (stays) {
      kept.push(stays);
      continue;
    }
    const edited = previous.find((t) => sameName(t.name, p.name) && !insert.some((i) => sameName(i.name, t.name)));
    insert.push({
      ...p,
      name: edited?.name ?? p.name,
      autonomy: edited?.autonomy ?? ((p.autonomy ?? "ask") as Autonomy),
      schedule: edited ? edited.schedule : p.schedule,
      schedulePrompt: edited ? edited.schedulePrompt : p.schedulePrompt,
      browserAccess: edited?.browserAccess ?? false,
      whatsappAccess: edited?.whatsappAccess ?? false,
      shellAccess: edited?.shellAccess ?? false,
    });
  }
  return { insert, kept };
}
