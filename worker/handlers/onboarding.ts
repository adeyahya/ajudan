import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { describeToolUse, runAgent } from "@/lib/claude";
import { logEvent } from "@/lib/events";
import { enqueueJob, type JobPayloads } from "@/lib/jobs";
import { PausedError, runAbortController } from "../session";
import { getLanguage, languageInstruction } from "@/lib/language";
import { businessWorkspace } from "@/lib/paths";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/types";

const INTERVIEW_TOOLS = ["WebSearch", "WebFetch"];

function interviewerSystemPrompt(name: string, website: string | null, language: string) {
  return `You are the onboarding interviewer for Ajudan, a service that builds a team of AI teammates (marketing, content, social, SEO, research, sales, support, ads) for small businesses.

You are interviewing the owner of "${name}"${website ? ` (website: ${website})` : ""}. Your goal is to learn enough to write a complete business profile and design the right AI team.

Cover these topics over the interview (skip what you already learned from the website, confirm what you inferred):
1. Products and pricing
2. Target customers
3. Sales and marketing channels used today
4. Brand voice and personality
5. Main competitors
6. Goals for the next 90 days, with concrete numbers
7. Budget and time constraints, things to avoid
8. What the owner wants the AI team to do for them

Rules:
- Be warm, concise and specific to this business. Plain text, no markdown headings; short paragraphs or simple "- " lists are fine.
- Ask 1-3 focused questions per message, never more. Number them when there are several.
- When an answer is vague (especially goals), ask for a number or example.
- Use WebSearch/WebFetch only when it clearly helps (e.g. first look at the website, or checking a competitor the owner names). Keep research brief.
- After about 5-8 exchanges, or as soon as you have enough on all topics, give a short recap of what you learned and tell the owner they can press "Finish interview" (they can also keep adding details).
- Never invent facts about the business; mark guesses as guesses.

${languageInstruction(language)}`;
}

export async function onboardingTurn({ businessId }: JobPayloads["onboarding_turn"]) {
  const ac = runAbortController();
  try {
    const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
    if (!biz) throw new Error(`Business ${businessId} not found`);
    const messages = db
      .select()
      .from(schema.onboardingMessages)
      .where(eq(schema.onboardingMessages.businessId, businessId))
      .orderBy(asc(schema.onboardingMessages.createdAt))
      .all();
    const userMessages = messages.filter((m) => m.role === "user");
    const last = messages.at(-1);
    const resume = biz.onboardingSessionId ?? undefined;

    const lang = getLanguage(biz.language).nativeLabel;
    let prompt: string;
    if (!resume || userMessages.length === 0) {
      // First turn (or the session was lost): research, then greet.
      const transcript = messages.length
        ? `\n\nThe conversation so far (continue from it):\n${messages.map((m) => `${m.role === "user" ? "Owner" : "You"}: ${m.content}`).join("\n\n")}`
        : "";
      prompt = `Start the onboarding interview for "${biz.name}".${
        biz.website
          ? ` First research the business: fetch ${biz.website} (and one or two key pages such as shop/about if useful) and do a quick web search for the brand.`
          : " There is no website, so do not research; just start the interview."
      } Then greet the owner in ${lang}, summarise in a few lines what you learned (products, price range, positioning), and ask your first 1-3 questions. Write your whole reply in ${lang}.${transcript}`;
    } else {
      if (!last || last.role !== "user") throw new Error("No new owner message to answer");
      const exchange = userMessages.length;
      prompt = `${last.content}\n\n[Interview note: this is owner answer #${exchange}. Reply in ${lang}.${
        exchange >= 5 ? " You are near the end; if you have enough, recap and invite them to press \"Finish interview\"." : ""
      }]`;
    }

    const res = await runAgent({
      prompt,
      systemPrompt: interviewerSystemPrompt(biz.name, biz.website, biz.language),
      cwd: businessWorkspace(),
      tools: INTERVIEW_TOOLS,
      allowedTools: INTERVIEW_TOOLS,
      resume: userMessages.length ? resume : undefined,
      maxTurns: userMessages.length ? 8 : 14,
      maxBudgetUsd: userMessages.length ? 1 : 2,
      abortController: ac,
      // Live trace for the chat UI ("Reading orucraft.com…").
      onMessage: (m) => {
        if (m.type !== "assistant") return;
        for (const block of m.message.content) {
          if (block.type !== "tool_use") continue;
          const input = (block.input ?? {}) as Record<string, unknown>;
          logEvent({ businessId, type: "onboarding_tool", message: describeToolUse(block.name, input), data: { tool: block.name } });
        }
      },
    });
    if (!res.ok) throw new Error(res.error ?? "Interviewer run failed");
    const reply = res.text.trim();
    if (!reply) throw new Error("Interviewer returned an empty reply");

    db.insert(schema.onboardingMessages).values({ businessId, role: "assistant", content: reply }).run();
    db.update(schema.businesses)
      .set({ busy: false, onboardingSessionId: res.sessionId ?? biz.onboardingSessionId })
      .where(eq(schema.businesses.id, businessId))
      .run();
    logEvent({ businessId, type: "onboarding_reply", message: reply.slice(0, 200), data: { costUsd: res.costUsd } });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError(); // stays busy; reruns when reopened
    failed(businessId, "turn", err);
    throw err;
  }
}

export async function onboardingFinalize({ businessId }: JobPayloads["onboarding_finalize"]) {
  const ac = runAbortController();
  try {
    const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
    if (!biz) throw new Error(`Business ${businessId} not found`);
    const messages = db
      .select()
      .from(schema.onboardingMessages)
      .where(eq(schema.onboardingMessages.businessId, businessId))
      .orderBy(asc(schema.onboardingMessages.createdAt))
      .all();
    const transcript = messages.map((m) => `${m.role === "user" ? "OWNER" : "INTERVIEWER"}: ${m.content}`).join("\n\n");

    const res = await runAgent<BusinessProfile>({
      prompt: `Business name: ${biz.name}
Website: ${biz.website ?? "(none)"}

Here is the full onboarding interview transcript:

<transcript>
${transcript}
</transcript>

Write the business profile. Use the owner's own facts and numbers; where the owner confirmed something the interviewer inferred, include it. Keep lists concise (short items). Goals must have a measurable metric and a target with a timeframe. Do not invent facts that are not supported by the transcript; leave a list empty if nothing is known. Write all profile text in ${getLanguage(biz.language).nativeLabel}, even where the transcript uses another language.`,
      systemPrompt: `You turn onboarding interviews into a structured business profile (the 'company brain' every AI teammate reads). Be accurate, specific and concise.\n\n${languageInstruction(biz.language)}`,
      cwd: businessWorkspace(),
      tools: [],
      outputSchema: BusinessProfileSchema,
      maxTurns: 4,
      maxBudgetUsd: 1,
      abortController: ac,
    });
    if (!res.ok || !res.structured) throw new Error(res.error ?? "No profile returned");
    const profile: BusinessProfile = { ...res.structured, name: biz.name, website: biz.website };

    db.update(schema.businesses).set({ profile, status: "designing" }).where(eq(schema.businesses.id, businessId)).run();
    logEvent({ businessId, type: "profile_ready", message: `Business profile ready: ${profile.oneLiner}` });
    enqueueJob("design_team", { businessId });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError();
    failed(businessId, "finalize", err);
    throw err;
  }
}

function failed(businessId: string, job: "turn" | "finalize", err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  db.update(schema.businesses).set({ busy: false }).where(eq(schema.businesses.id, businessId)).run();
  logEvent({ businessId, type: "onboarding_error", message, data: { job } });
}
