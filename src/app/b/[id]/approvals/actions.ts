"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { CAPABILITY, grantCapability } from "@/lib/capabilities";
import { logEvent } from "@/lib/events";

/**
 * Approve or reject a pending outward action. The worker is polling the row and
 * continues the teammate's run (and logs approval_granted/rejected) once decided.
 * FormData: businessId, approvalId, decision ("approved" | "rejected"), note?.
 */
export async function decideApproval(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const approvalId = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (decision !== "approved" && decision !== "rejected") throw new Error("Invalid decision");
  db.update(schema.approvals)
    .set({ status: decision, note, decidedAt: new Date() })
    .where(
      and(
        eq(schema.approvals.id, approvalId),
        eq(schema.approvals.businessId, businessId),
        eq(schema.approvals.status, "pending"),
      ),
    )
    .run();
  refresh();
}

/**
 * Approve a teammate's request for an ability (request_capability): switch it on (a
 * credential goes to the Keychain), then the teammate gets a task to carry on.
 * FormData: secret? (for credentials), note?.
 */
export async function approveCapability(businessId: string, approvalId: string, _prev: { error?: string; ok?: string }, fd: FormData) {
  const approval = db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending")))
    .get();
  if (!approval || approval.toolName !== CAPABILITY) return { error: "This request was already decided." };
  const note = String(fd.get("note") ?? "").trim() || null;
  try {
    await grantCapability(approval, { secretValue: String(fd.get("value") ?? ""), note });
  } catch (err) {
    return { error: (err as Error).message };
  }
  db.update(schema.approvals).set({ status: "approved", note, decidedAt: new Date() }).where(eq(schema.approvals.id, approval.id)).run();
  logEvent({ businessId, teammateId: approval.teammateId, taskId: approval.taskId, type: "approval_granted", message: `Owner approved: ${approval.summary}`, data: { approvalId } });
  refresh();
  return { ok: "Approved" };
}

export async function rejectCapability(businessId: string, approvalId: string, fd: FormData) {
  const note = String(fd.get("note") ?? "").trim() || null;
  db.update(schema.approvals)
    .set({ status: "rejected", note, decidedAt: new Date() })
    .where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending")))
    .run();
  refresh();
}
