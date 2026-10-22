"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { recordDeliverableFeedback } from "@/lib/feedback";
import { t, type MessageKey } from "@/lib/i18n";
import { syncDeliverableFile } from "@/lib/workfiles";

export type FeedbackState = { error?: string; ok?: string };

/**
 * "Looks good" or "Needs changes" from the Work page (the submit button's verdict).
 * FormData: businessId, deliverableId, verdict ("good" | "changes"), note.
 */
/** recordDeliverableFeedback()'s errors (English, also used outside the app) → the owner's language. */
const FEEDBACK_ERRORS: Record<string, MessageKey> = {
  "Say what should change.": "work.fb.sayWhat",
  "Deliverable not found.": "work.fb.notFound",
  "This was already posted. Ask the manager for a new version instead.": "work.fb.alreadyPosted",
};

export async function giveFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const lang = String(formData.get("lang") ?? ""); // the UI language the form was shown in (LangField)
  const verdict = String(formData.get("verdict") ?? "");
  if (verdict !== "good" && verdict !== "changes") return { error: t(lang, "work.fb.choose") };
  try {
    const { task } = recordDeliverableFeedback({
      businessId: String(formData.get("businessId") ?? ""),
      deliverableId: String(formData.get("deliverableId") ?? ""),
      verdict,
      note: String(formData.get("note") ?? ""),
    });
    refresh();
    return {
      ok: t(lang, verdict === "good" ? "work.fb.thanks" : task ? "work.fb.sentBack" : "work.fb.noted"),
    };
  } catch (err) {
    const message = (err as Error).message;
    const key = FEEDBACK_ERRORS[message];
    return { error: key ? t(lang, key) : message };
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
