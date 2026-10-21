"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";

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
