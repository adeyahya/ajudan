import { and, eq, like } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval } from "@/db/schema";
import { CAPABILITY, grantCapability, type CapabilityRequest } from "@/lib/capabilities";
import { logEvent } from "@/lib/events";
import { reactToDecision } from "@/lib/manager";

/**
 * Approving or rejecting, from the Approvals page or by the owner on WhatsApp
 * (worker/owner-approvals.ts). A teammate's run that's waiting picks the decision up
 * by itself; capability requests are switched on here; the manager then reacts.
 */

export type DecideResult = { ok: true; approval: Approval } | { ok: false; error: string };

/** Short code the owner types on WhatsApp ("ya A7F2"): the first 4 characters of the id. */
export const approvalCode = (a: Pick<Approval, "id">) => a.id.slice(0, 4).toUpperCase();

export function findPendingByCode(businessId: string, code: string) {
  return db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending"), like(schema.approvals.id, `${code.toLowerCase()}%`)))
    .all();
}

export async function decide(p: {
  businessId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  note?: string | null;
  /** Capability requests for a credential need its value (only from the app). */
  secretValue?: string;
  via: "app" | "whatsapp";
}): Promise<DecideResult> {
  const pending = db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.id, p.approvalId), eq(schema.approvals.businessId, p.businessId), eq(schema.approvals.status, "pending")))
    .get();
  if (!pending) return { ok: false, error: "This request was already decided." };
  const note = p.note?.trim() || null;

  if (pending.toolName === CAPABILITY && p.decision === "approved") {
    const r = pending.input as CapabilityRequest;
    if (r.kind === "secret" && !p.secretValue?.trim()) {
      return { ok: false, error: `${r.name} is a credential: enter it in the app (Approvals page), never in a chat.` };
    }
    try {
      await grantCapability(pending, { secretValue: p.secretValue, note });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // Only one decision wins (double clicks, the app and WhatsApp at the same time).
  const decided = db
    .update(schema.approvals)
    .set({ status: p.decision, note, decidedAt: new Date() })
    .where(and(eq(schema.approvals.id, pending.id), eq(schema.approvals.status, "pending")))
    .returning()
    .get();
  if (!decided) return { ok: false, error: "This request was already decided." };
  if (decided.toolName === CAPABILITY) {
    logEvent({
      businessId: p.businessId,
      teammateId: decided.teammateId,
      taskId: decided.taskId,
      type: p.decision === "approved" ? "approval_granted" : "approval_rejected",
      message: `Owner ${p.decision}${p.via === "whatsapp" ? " on WhatsApp" : ""}: ${decided.summary}`,
      data: { approvalId: decided.id },
    });
  }
  reactToDecision(decided, p.via);
  return { ok: true, approval: decided };
}
