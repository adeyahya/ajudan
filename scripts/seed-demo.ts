/**
 * Seed an active demo business so the office can be viewed without running Claude.
 *   npx tsx scripts/seed-demo.ts
 * Prints the new business id.
 */
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { ROLE_TEMPLATES } from "@/lib/roles";

const TEAM: { roleKey: string; name: string }[] = [
  { roleKey: "growth_lead", name: "Raka" },
  { roleKey: "content_marketer", name: "Sari" },
  { roleKey: "social_media_manager", name: "Dimas" },
  { roleKey: "market_researcher", name: "Ayu" },
];

const business = db
  .insert(schema.businesses)
  .values({
    name: "Orucraft (demo)",
    website: "https://orucraft.example",
    status: "active",
    teamSummary: "A small growth team for a handmade origami and paper-craft studio.",
  })
  .returning()
  .get();

const teammates = TEAM.map((t, i) => {
  const role = ROLE_TEMPLATES.find((r) => r.key === t.roleKey);
  if (!role) throw new Error(`Unknown role ${t.roleKey}`);
  return db
    .insert(schema.teammates)
    .values({
      businessId: business.id,
      name: t.name,
      roleKey: role.key,
      title: role.title,
      color: role.color,
      persona: role.instructions,
      responsibilities: [role.summary],
      kpis: role.defaultKpis,
      status: "active",
      state: "idle",
      deskIndex: i,
    })
    .returning()
    .get();
});

const [lead, content, social, research] = teammates;
logEvent({ businessId: business.id, type: "team_hired", message: "The team was hired and the office is open." });
logEvent({ businessId: business.id, teammateId: lead.id, type: "text", message: "Drafted this week's growth plan." });
logEvent({
  businessId: business.id,
  teammateId: lead.id,
  type: "delegated",
  message: `Asked ${research.name} to research competitor pricing.`,
  data: { from: lead.id, to: research.id },
});
logEvent({ businessId: business.id, teammateId: research.id, type: "task_done", message: "Finished a competitor pricing scan." });
logEvent({
  businessId: business.id,
  teammateId: content.id,
  type: "task_done",
  message: "Wrote a blog post: 5 gift ideas made from paper.",
});
logEvent({
  businessId: business.id,
  teammateId: social.id,
  type: "task_done",
  message: "Drafted 3 Instagram captions for the new collection.",
});

// A few finished pieces so the office's Work shelf isn't empty.
for (const [tm, title] of [
  [content, "5 gift ideas made from paper"],
  [social, "Instagram captions for the new collection"],
  [research, "Competitor pricing scan"],
] as const) {
  db.insert(schema.deliverables)
    .values({ businessId: business.id, teammateId: tm.id, kind: "report", title, content: `Demo content: ${title}` })
    .run();
}

console.log(business.id);
