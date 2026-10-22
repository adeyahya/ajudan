"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decide } from "@/lib/approvals";
import { t } from "@/lib/i18n";

/** decide()'s errors are shared with WhatsApp approvals; translate the one the owner sees here. */
function ownerError(businessId: string, error: string) {
  const lang = db.select({ language: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.language;
  return error === "This request was already decided." ? t(lang, "approvals.err.alreadyDecided") : error;
}

/**
 * Approve or reject a pending outward action. The decision queues the waiting task's
 * continuation (the worker resumes its Claude session) and logs approval_granted/rejected.
 * FormData: businessId, approvalId, decision ("approved" | "rejected"), note?.
 */
export async function decideApproval(formData: FormData) {
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "approved" && decision !== "rejected") throw new Error("Invalid decision");
  await decide({
    businessId: String(formData.get("businessId") ?? ""),
    approvalId: String(formData.get("approvalId") ?? ""),
    decision,
    note: String(formData.get("note") ?? ""),
    via: "app",
  });
  refresh();
}

/**
 * Approve a teammate's request for an ability (request_capability): switch it on (a
 * credential goes to the Keychain), then the teammate gets a task to carry on.
 * FormData: value? (for credentials), note?.
 */
export async function approveCapability(businessId: string, approvalId: string, _prev: { error?: string; ok?: string }, fd: FormData) {
  const r = await decide({
    businessId,
    approvalId,
    decision: "approved",
    note: String(fd.get("note") ?? ""),
    secretValue: String(fd.get("value") ?? ""),
    via: "app",
  });
  refresh();
  return r.ok ? { ok: "Approved" } : { error: ownerError(businessId, r.error) };
}

export async function rejectCapability(businessId: string, approvalId: string, fd: FormData) {
  await decide({ businessId, approvalId, decision: "rejected", note: String(fd.get("note") ?? ""), via: "app" });
  refresh();
}
