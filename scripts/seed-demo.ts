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

// A week of outcomes so the chat home's XP, levels, trust and streak have something to show
// (src/lib/progress.ts): finished tasks, a WhatsApp chat answered, verdicts and approvals.
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
for (const [tm, title, days, createdBy] of [
  [research, "Competitor pricing scan", 6, "user"],
  [content, "Blog post: 5 gift ideas", 5, "user"],
  [social, "Captions for the new collection", 4, "user"],
  [social, "Customer asked about custom orders", 3, "system:reply"],
  [lead, "Weekly growth plan", 2, "schedule"],
  [content, "Newsletter draft", 1, "user"],
] as const) {
  db.insert(schema.tasks)
    .values({ businessId: business.id, teammateId: tm.id, title, instructions: title, status: "done", result: `Done: ${title}`, createdBy, createdAt: ago(days, 9), finishedAt: ago(days, 11) })
    .run();
}
for (const [tm, title, status, revised] of [
  [content, "Gift guide carousel", "published", false],
  [social, "Story poll for Friday", "approved", false],
  [social, "Launch post", "approved", true],
  [research, "Supplier shortlist", "rejected", false],
] as const) {
  db.insert(schema.deliverables)
    .values({
      businessId: business.id,
      teammateId: tm.id,
      kind: "social_post",
      title,
      content: `Demo content: ${title}`,
      status,
      versions: revised ? [{ title, content: "Earlier draft", attachments: [], savedAt: ago(2).toISOString(), byTeammateId: tm.id }] : [],
      createdAt: ago(2),
    })
    .run();
}
// Approvals decided the same day for the last three days (a 3-day clean-queue streak), one waiting today.
for (const days of [3, 2, 1]) {
  db.insert(schema.approvals)
    .values({ businessId: business.id, teammateId: social.id, toolName: "send_message", input: {}, summary: "Reply to a customer", status: "approved", createdAt: ago(days, 9), decidedAt: ago(days, 15) })
    .run();
}
db.insert(schema.approvals)
  .values({ businessId: business.id, teammateId: content.id, toolName: "send_message", input: {}, summary: "Send the newsletter to 120 subscribers", status: "pending" })
  .run();

console.log(business.id);
