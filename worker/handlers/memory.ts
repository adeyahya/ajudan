import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { MODELS, runAgent } from "@/lib/claude";
import { logEvent } from "@/lib/events";
import type { JobPayloads } from "@/lib/jobs";
import { languageInstruction } from "@/lib/language";
import { MEMORY_SECTIONS, memoryNeedsConsolidation, memoryTitle, rejectConsolidated } from "@/lib/memory";
import { resolveWorkspace } from "@/lib/paths";
import { PausedError, runAbortController } from "../session";

const Output = z.object({ memory: z.string() });

/**
 * Rewrite a teammate's grown memory.md into Preferences / Decisions / Lessons / Facts
 * on the fast model, keeping the previous version next to it as memory.prev.md.
 * Queued by the task handler after a run; nothing waits on it.
 */
export async function consolidateMemory({ teammateId }: JobPayloads["consolidate_memory"]) {
  const teammate = db.select().from(schema.teammates).where(eq(schema.teammates.id, teammateId)).get();
  if (!teammate?.workspaceDir) return;
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, teammate.businessId)).get();
  if (!business) return;
  const dir = resolveWorkspace(teammate.workspaceDir);
  const file = path.join(dir, "memory.md");
  if (!fs.existsSync(file)) return;
  const before = fs.statSync(file);
  if (!memoryNeedsConsolidation(before.size)) return;
  const original = fs.readFileSync(file, "utf8");

  const ac = runAbortController();
  try {
    const res = await runAgent<z.infer<typeof Output>>({
      cwd: path.join(dir, "work"),
      model: MODELS.fast,
      systemPrompt: `You tidy the long-term notes of ${teammate.name}, the ${teammate.title} on ${business.name}'s AI team. The notes are read in full before every piece of work, so they must stay short and useful. You never invent anything that isn't in the notes.\n\n${languageInstruction(business.language)}`,
      prompt: `Rewrite these notes as Markdown with exactly this structure:

${memoryTitle(original) ?? `# ${teammate.name}'s memory (${teammate.title})`}

## Preferences
(what the owner wants and doesn't want: keep every owner preference, in its original wording)

## Decisions
(decisions made and why; the most recent wins when they conflict)

## Lessons
(what worked, what didn't, how to do things here)

## Facts
(durable facts about the business, customers, channels, people, files)

Rules: merge duplicates, drop one-off task logs and anything no longer true, keep names, numbers, dates and links exactly, one bullet per point, no commentary. Keep every section heading even when it's empty. Aim for well under half the length.

<notes>
${original}
</notes>`,
      tools: [],
      outputSchema: Output,
      maxTurns: 2,
      maxBudgetUsd: 0.5,
      abortController: ac,
    });
    if (!res.ok || !res.structured) throw new Error(res.error ?? "No rewrite returned");
    const rewritten = `${res.structured.memory.trim()}\n`;
    const why = rejectConsolidated(original, rewritten);
    if (why) throw new Error(`Rewrite rejected (${why})`);

    // Another run may have appended meanwhile: don't lose what it wrote.
    const after = fs.statSync(file);
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      console.log(`[memory] ${teammate.name}'s memory.md changed during the rewrite; trying again after the next task`);
      return;
    }
    fs.writeFileSync(path.join(dir, "memory.prev.md"), original);
    fs.writeFileSync(file, rewritten);
    logEvent({
      businessId: business.id,
      teammateId: teammate.id,
      type: "memory_consolidated",
      message: `${teammate.name} tidied their memory (${(before.size / 1024).toFixed(1)} KB → ${(Buffer.byteLength(rewritten) / 1024).toFixed(1)} KB)`,
      data: { costUsd: res.costUsd, sections: [...MEMORY_SECTIONS] },
    });
  } catch (err) {
    if (ac.signal.aborted) throw new PausedError();
    throw err;
  }
}
