import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MODELS, runAgent } from "@/lib/claude";
import { contextPrompt, ensureContextWorkspace } from "@/lib/context";
import { logEvent } from "@/lib/events";
import type { JobPayloads } from "@/lib/jobs";
import { languageInstruction } from "@/lib/language";
import { dataDir, resolveWorkspace } from "@/lib/paths";
import { UsageLimitError } from "@/lib/rest";
import { PausedError, runAbortController } from "../session";

const Output = z.object({
  answer: z.string(),
  cited_pages: z.array(z.string()).describe("Titles of the pages the answer came from, exactly as written"),
});

/**
 * The inspector's "Test-ask": what a teammate would answer from its context alone.
 * Same pages (always in full, the rest by title) and memory as a real run, on the fast
 * model, with no tools: nothing is fetched, saved or sent.
 */
export async function contextTestAsk({ askId }: JobPayloads["context_test_ask"]) {
  const ask = db.select().from(schema.contextAsks).where(eq(schema.contextAsks.id, askId)).get();
  if (!ask || ask.status !== "queued") return;
  const teammate = db.select().from(schema.teammates).where(eq(schema.teammates.id, ask.teammateId)).get();
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, ask.businessId)).get();
  if (!teammate || !business) return;
  ensureContextWorkspace(business.id);
  const { prompt } = contextPrompt(business.id, teammate.id);
  const dir = teammate.workspaceDir ? resolveWorkspace(teammate.workspaceDir) : path.join(dataDir(), "teammates");
  let memory = "";
  try {
    memory = fs.readFileSync(path.join(dir, "memory.md"), "utf8").slice(0, 8000);
  } catch {
    // never ran
  }
  const ac = runAbortController();
  const finish = (v: Partial<typeof ask>) => {
    db.update(schema.contextAsks).set(v).where(eq(schema.contextAsks.id, ask.id)).run();
    logEvent({ businessId: business.id, teammateId: teammate.id, type: "context_ask_done", message: `Test question to ${teammate.name} answered`, data: { askId: ask.id } });
  };
  try {
    const r = await runAgent<z.infer<typeof Output>>({
      cwd: path.join(dir, "work"),
      model: MODELS.fast,
      systemPrompt: `You are ${teammate.name}, the ${teammate.title} on ${business.name}'s AI team. The owner is testing what you know: answer their question only from the context and notes below, briefly, as you would at work. If they don't say, answer that you don't know from the pages (and which page should say it). You have no tools in this test. List the titles of the pages you used in cited_pages.

${prompt || "(No pages are shared with you yet.)"}

## Your memory.md
${memory || "(empty)"}

${languageInstruction(business.language)}`,
      prompt: ask.question,
      tools: [],
      outputSchema: Output,
      maxTurns: 2,
      maxBudgetUsd: 0.3,
      effort: "low",
      abortController: ac,
    });
    if (!r.ok || !r.structured) throw new Error(r.error ?? "No answer");
    finish({ status: "done", answer: r.structured.answer, cited: r.structured.cited_pages.slice(0, 12), costUsd: r.costUsd });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError();
    // Out of usage: the job waits in the queue and the question stays open.
    if (err instanceof UsageLimitError) throw err;
    finish({ status: "failed", answer: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
