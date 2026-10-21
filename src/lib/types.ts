import { z } from "zod";

/** The "company brain": everything every teammate knows about the business. */
export const BusinessProfileSchema = z.object({
  name: z.string(),
  website: z.string().nullable(),
  oneLiner: z.string().describe("What the business does, in one sentence"),
  description: z.string().describe("A paragraph describing the business, products and how it makes money"),
  products: z.array(z.string()),
  targetCustomers: z.array(z.string()),
  channels: z.array(z.string()).describe("Where the business sells or markets today"),
  brandVoice: z.string(),
  competitors: z.array(z.string()),
  goals: z
    .array(
      z.object({
        goal: z.string(),
        metric: z.string().describe("How progress is measured"),
        target: z.string().describe("Target value and timeframe"),
      }),
    )
    .describe("Goals for roughly the next 90 days"),
  constraints: z.array(z.string()).describe("Budget, time, tools, things to avoid"),
  teamNeeds: z.array(z.string()).describe("What the owner wants the AI team to do"),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const TeammateProposalSchema = z.object({
  name: z.string().describe("A friendly first name"),
  roleKey: z.string().describe("One of the role template keys"),
  title: z.string(),
  why: z.string().describe("Why this teammate is needed for this business"),
  persona: z.string().describe("Role-specific instructions for this business"),
  responsibilities: z.array(z.string()),
  kpis: z.array(z.string()),
  autonomy: z.enum(["draft", "ask", "auto"]),
  schedule: z.string().nullable().describe("Cron expression for recurring work, or null"),
  schedulePrompt: z.string().nullable().describe("What to do on each scheduled run, or null"),
});
export type TeammateProposal = z.infer<typeof TeammateProposalSchema>;

export const TeamProposalSchema = z.object({
  summary: z.string(),
  teammates: z.array(TeammateProposalSchema),
});
export type TeamProposal = z.infer<typeof TeamProposalSchema>;
