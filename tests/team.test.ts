import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BusinessProfile, TeammateProposal } from "@/lib/types";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-team-"));
const { defaultPersona, mergeProposal, normalizeTeam, parseLines, renderCurrentTeam } = await import("@/lib/team");
type CurrentTeammate = import("@/lib/team").CurrentTeammate;

const profile: BusinessProfile = {
  name: "Orucraft",
  website: null,
  oneLiner: "Handmade wooden toys for toddlers.",
  description: "…",
  products: ["Stacking blocks", "Name puzzles"],
  targetCustomers: ["Parents of 1-4 year olds"],
  channels: ["Shopee", "Instagram"],
  brandVoice: "Warm and playful.",
  competitors: [],
  goals: [],
  constraints: ["No paid ads this quarter"],
  teamNeeds: ["Weekly TikTok scripts", "Answer reseller questions"],
};

const proposal = (over: Partial<TeammateProposal>): TeammateProposal => ({
  name: "Sam",
  roleKey: "content_marketer",
  title: "Content Marketer",
  why: "why",
  persona: "persona",
  responsibilities: ["r"],
  kpis: ["k"],
  autonomy: "ask",
  schedule: null,
  schedulePrompt: null,
  ...over,
});

const current = (over: Partial<CurrentTeammate>): CurrentTeammate => ({
  id: "id",
  name: "Sam",
  roleKey: "content_marketer",
  title: "Content Marketer",
  persona: "old persona",
  responsibilities: ["old"],
  kpis: [],
  autonomy: "draft",
  schedule: "0 9 * * 1",
  schedulePrompt: "weekly",
  status: "proposed",
  browserAccess: true,
  whatsappAccess: false,
  shellAccess: true,
  ...over,
});

describe("parseLines", () => {
  it("splits on newlines and semicolons, strips bullets, caps the count", () => {
    expect(parseLines("- a\n• b; c\n\n  \n")).toEqual(["a", "b", "c"]);
    expect(parseLines("1\n2\n3", 2)).toEqual(["1", "2"]);
  });
});

describe("defaultPersona", () => {
  it("writes a brief from the profile without the role template's instructions", () => {
    const p = defaultPersona({ title: "Social Media Manager" }, profile);
    expect(p).toContain("You are the Social Media Manager for Orucraft: Handmade wooden toys for toddlers.");
    expect(p).toContain("Products: Stacking blocks, Name puzzles.");
    expect(p).toContain("Brand voice: Warm and playful.");
    expect(p).toContain("Weekly TikTok scripts; Answer reseller questions");
    expect(p).toContain("Keep in mind: No paid ads this quarter.");
    expect(p).not.toContain("save_deliverable");
  });

  it("skips empty sections", () => {
    const p = defaultPersona({ title: "X" }, { ...profile, products: [], brandVoice: " ", constraints: [], teamNeeds: [] });
    expect(p).not.toContain("Products");
    expect(p).not.toContain("Brand voice");
    expect(p).not.toContain("Keep in mind");
  });
});

describe("normalizeTeam", () => {
  const lead = () => proposal({ name: "Maya", roleKey: "growth_lead", title: "Growth Lead" });

  it("adds a growth lead when none is proposed and the team has none", () => {
    const team = normalizeTeam([proposal({})], { defaultLead: lead });
    expect(team.map((t) => t.roleKey)).toEqual(["growth_lead", "content_marketer"]);
  });

  it("drops a proposed growth lead when the active team already has one", () => {
    const team = normalizeTeam([lead(), proposal({})], { hasLead: true, defaultLead: lead });
    expect(team.map((t) => t.roleKey)).toEqual(["content_marketer"]);
  });

  it("drops unknown roles and the manager, caps at five, validates schedules", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((n) => proposal({ name: n }));
    const team = normalizeTeam(
      [proposal({ roleKey: "nope" }), proposal({ roleKey: "manager" }), proposal({ name: "s", schedule: "not cron", schedulePrompt: "x" }), ...many],
      { hasLead: true, defaultLead: lead },
    );
    expect(team).toHaveLength(5);
    expect(team[0].name).toBe("s");
    expect(team[0].schedule).toBeNull();
    expect(team[0].schedulePrompt).toBeNull();
  });
});

describe("mergeProposal", () => {
  it("never touches active teammates: a proposal with their name is dropped and reported as kept", () => {
    const active = current({ id: "a1", name: "Sam", status: "active" });
    const { insert, kept } = mergeProposal([active], [proposal({ name: "sam " }), proposal({ name: "Rina", roleKey: "seo_specialist" })]);
    expect(kept).toEqual([active]);
    expect(insert.map((t) => t.name)).toEqual(["Rina"]);
  });

  it("keeps the owner's edits to a re-proposed teammate", () => {
    const edited = current({ name: "Samuel" });
    const { insert } = mergeProposal([edited], [proposal({ name: "samuel", persona: "new persona", autonomy: "auto", schedule: null })]);
    expect(insert).toHaveLength(1);
    expect(insert[0]).toMatchObject({
      name: "Samuel",
      persona: "new persona",
      autonomy: "draft",
      schedule: "0 9 * * 1",
      schedulePrompt: "weekly",
      browserAccess: true,
      shellAccess: true,
      whatsappAccess: false,
    });
  });

  it("new names start with the proposal's own settings and no abilities", () => {
    const { insert } = mergeProposal([], [proposal({ name: "New", autonomy: "draft", schedule: "0 8 * * 2", schedulePrompt: "p" })]);
    expect(insert[0]).toMatchObject({ name: "New", autonomy: "draft", schedule: "0 8 * * 2", schedulePrompt: "p", browserAccess: false });
  });

  it("renders the current team for the prompt, marking who can't be removed", () => {
    const text = renderCurrentTeam([current({ status: "active" }), current({ name: "Rina" })]);
    expect(text).toContain("name: Sam");
    expect(text).toContain("cannot be removed");
    expect(text).toContain("name: Rina");
    expect(text).toContain("proposed (the owner has reviewed it)");
  });
});
