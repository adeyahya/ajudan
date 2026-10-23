import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MODELS, runAgent } from "@/lib/claude";
import { createSuggestion, ensureContextWorkspace, forAgents, listPages, SECTIONS, usageThisWeek } from "@/lib/context";
import { logEvent } from "@/lib/events";
import type { JobPayloads } from "@/lib/jobs";
import { languageInstruction } from "@/lib/language";
import { ensureManager } from "@/lib/manager";
import { dataDir, resolveWorkspace } from "@/lib/paths";
import { planSuggestions, REORGANIZE_ACTIONS, REORGANIZE_SOURCE, supersedeReorganize } from "@/lib/reorganize";
import { UsageLimitError } from "@/lib/rest";
import { PausedError, runAbortController } from "../session";

const Section = z.enum(SECTIONS as [string, ...string[]]);

const Output = z.object({
  summary: z.string().describe("Two or three sentences for the owner: what you'd change and why"),
  operations: z.array(
    z.object({
      action: z.enum(REORGANIZE_ACTIONS),
      page: z.string().optional().describe("The page's id (from the list). For merge: the page that stays"),
      merge_from: z.array(z.string()).optional().describe("merge only: ids of the pages folded into `page`"),
      title: z.string().optional().describe("A new title (retitle, merge, split, or new_page's title)"),
      section: Section.optional().describe("Move to this section (move), or new_page's section"),
      markdown: z.string().optional().describe("merge/split/rewrite: the page's complete new text; append: only the text to add; new_page: its text"),
      new_pages: z.array(z.object({ title: z.string(), section: Section.optional(), markdown: z.string() })).optional().describe("split only: the new pages"),
      reason: z.string().describe("One sentence for the owner, in their language"),
    }),
  ),
});

/** Per page and in all, how much page text the reviewer reads. */
const PAGE_CHARS = 8_000;
const TOTAL_CHARS = 80_000;
const MEMORY_CHARS = 6_000;

/**
 * The Context "Reorganize with AI" review (src/lib/reorganize.ts): the agent reads every
 * page and the AI teammates' memory.md, and returns a plan; each step becomes a
 * suggestion from the manager that the owner accepts or rejects. No page is changed
 * here. Queued by the owner (Context → Organize) or weekly when they turned that on.
 */
export async function reorganizeContext({ businessId }: JobPayloads["context_reorganize"]) {
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!business) return;
  ensureContextWorkspace(businessId);
  const manager = ensureManager(businessId);
  if (!manager) return;
  const pages = listPages(businessId);
  const textPages = pages.filter((p) => p.kind === "page");
  if (!textPages.length) return;

  const usage = usageThisWeek(businessId);
  const byId = new Map(pages.map((p) => [p.id, p]));
  let budget = TOTAL_CHARS;
  const pageBlocks = textPages.map((p) => {
    const body = forAgents(p.body).trim();
    const room = Math.max(0, Math.min(PAGE_CHARS, budget));
    const shown = body.slice(0, room);
    budget -= shown.length;
    const meta = [
      `id: ${p.id}`,
      `section: ${p.section}`,
      p.parentId && byId.get(p.parentId) ? `under: "${byId.get(p.parentId)!.title}"` : null,
      p.key ? "Ajudan's own page (never delete, merge away or move it; you may rewrite or retitle it)" : null,
      `${body.length} chars`,
      `updated ${(p.updatedAt ?? p.createdAt).toISOString().slice(0, 10)}`,
      `read in ${usage.get(p.id)?.runs ?? 0} runs this week`,
    ].filter(Boolean);
    return `<page title="${p.title.replace(/"/g, "'")}" ${meta.map((m) => `[${m}]`).join(" ")}>\n${shown || "(empty)"}${shown.length < body.length ? `\n…(${body.length - shown.length} more chars not shown: keep them if you rewrite this page, or leave it alone)` : ""}\n</page>`;
  });
  const databases = pages.filter((p) => p.kind === "database").map((p) => `- "${p.title}" (a database, not text: leave it)`);

  const mates = db.select().from(schema.teammates).where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active"), eq(schema.teammates.kind, "ai"))).all();
  const memories = mates
    .map((m) => {
      if (!m.workspaceDir) return null;
      try {
        const text = fs.readFileSync(path.join(resolveWorkspace(m.workspaceDir), "memory.md"), "utf8").trim();
        return text ? `<memory of="${m.name}, ${m.title}">\n${text.slice(0, MEMORY_CHARS)}\n</memory>` : null;
      } catch {
        return null; // never ran
      }
    })
    .filter(Boolean);

  const ac = runAbortController();
  try {
    const res = await runAgent<z.infer<typeof Output>>({
      cwd: dataDir(),
      model: MODELS.main,
      systemPrompt: `You are the editor of ${business.name}'s Context workspace: the pages the owner keeps about the business, which the AI team reads before working. Your job is to propose a tidier, more useful layout. The owner reviews every step and accepts or rejects it, so each step must stand on its own and be easy to judge.

Sections: business (who we are), product, people, how_we_work (rules, policies, processes), team_written (what the team learned).

What good looks like:
- One topic per page, one page per topic. Merge pages that cover the same thing (action merge: the page that stays gets the combined text; the others are removed).
- Pages short enough to read: split a page that mixes unrelated topics or is very long (action split: the page keeps one part, new_pages get the rest).
- Clear, specific titles (retitle) and the right section (move).
- No duplicated, contradicting or clearly outdated facts inside a page (rewrite: the complete new text). When two facts conflict, keep the newer one only if the page says which is newer; otherwise keep both and say so in the reason.
- Durable business facts that only live in a teammate's memory (prices, policies, customer preferences the owner stated) belong on a page (append to the right page, or new_page). Leave task logs and a teammate's personal working notes in their memory.
- delete only an empty page or one that is fully covered elsewhere.

Rules: never invent facts; keep names, numbers, prices, dates, phone numbers and links exactly. Keep the owner's wording where you can. Each page in at most one step. Write markdown (## headings, bullet lists). Propose nothing when the workspace is already in good shape: fewer, clearly useful steps beat many small ones (at most 12). Write page text, titles and reasons in the language the pages are written in.

${languageInstruction(business.language)}`,
      prompt: `The workspace has ${textPages.length} text pages.

${pageBlocks.join("\n\n")}
${databases.length ? `\nDatabases:\n${databases.join("\n")}\n` : ""}
${memories.length ? `\nWhat the AI teammates keep in their memory.md (read-only for you):\n\n${memories.join("\n\n")}\n` : ""}
Return your plan.`,
      tools: [],
      outputSchema: Output,
      maxTurns: 2,
      maxBudgetUsd: 2,
      effort: "medium",
      abortController: ac,
    });
    if (!res.ok || !res.structured) throw new Error(res.error ?? "No plan returned");

    // Pages may have changed while the agent read: plan against them as they are now.
    const planned = planSuggestions(listPages(businessId), res.structured.operations as Parameters<typeof planSuggestions>[1]);
    supersedeReorganize(businessId);
    const source = `${REORGANIZE_SOURCE}${new Date().toISOString().slice(0, 10)}`;
    for (const s of planned) {
      createSuggestion({ businessId, teammate: manager, page: s.page, kind: s.kind, body: s.body, title: s.title, section: s.section, reason: s.reason, source });
    }
    db.update(schema.businesses).set({ contextTidiedAt: new Date() }).where(eq(schema.businesses.id, businessId)).run();
    logEvent({
      businessId,
      teammateId: manager.id,
      type: "context_reorganized",
      message: planned.length ? `${manager.name} proposed ${planned.length} changes to tidy the Context pages` : `${manager.name} reviewed the Context pages: nothing to change`,
      data: { count: planned.length, summary: res.structured.summary.slice(0, 1000), costUsd: res.costUsd },
    });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError();
    // Out of usage: the worker requeues the job until the team is back.
    if (err instanceof UsageLimitError) throw err;
    // Counts as this week's review, so a failing one isn't retried (and paid for) every day.
    db.update(schema.businesses).set({ contextTidiedAt: new Date() }).where(eq(schema.businesses.id, businessId)).run();
    logEvent({ businessId, type: "context_reorganize_failed", message: `The Context review failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) });
    throw err;
  }
}
