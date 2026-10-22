"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { recordDeliverableFeedback } from "@/lib/feedback";
import { syncDeliverableFile } from "@/lib/workfiles";

export type FeedbackState = { error?: string; ok?: string };

/**
 * "Looks good" or "Needs changes" from the Work page (the submit button's verdict).
 * FormData: businessId, deliverableId, verdict ("good" | "changes"), note.
 */
export async function giveFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const verdict = String(formData.get("verdict") ?? "");
  if (verdict !== "good" && verdict !== "changes") return { error: "Choose Looks good or Needs changes." };
  try {
    const { task } = recordDeliverableFeedback({
      businessId: String(formData.get("businessId") ?? ""),
      deliverableId: String(formData.get("deliverableId") ?? ""),
      verdict,
      note: String(formData.get("note") ?? ""),
    });
    refresh();
    return {
      ok: verdict === "good" ? "Thanks, the team will remember that." : task ? "Sent back for changes." : "Noted. Nobody on the team can revise it right now.",
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** The owner posted it themselves. FormData: businessId, deliverableId. */
export async function markPosted(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const deliverableId = String(formData.get("deliverableId") ?? "");
  const d = db
    .update(schema.deliverables)
    .set({ status: "published" })
    .where(and(eq(schema.deliverables.id, deliverableId), eq(schema.deliverables.businessId, businessId)))
    .returning()
    .get();
  if (!d) throw new Error("Deliverable not found");
  syncDeliverableFile(d.id);
  logEvent({
    businessId,
    teammateId: d.teammateId,
    taskId: d.taskId,
    type: "deliverable_status",
    message: `Owner posted "${d.title}"`,
    data: { deliverableId: d.id, status: "published" },
  });
  refresh();
}
