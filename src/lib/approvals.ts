import { and, eq, inArray, isNotNull, like, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval } from "@/db/schema";
import { CAPABILITY, grantCapability, type CapabilityRequest } from "@/lib/capabilities";
import { logEvent } from "@/lib/events";
import { enqueueJob } from "@/lib/jobs";
import { reactToDecision } from "@/lib/manager";

/**
 * Approving or rejecting, from the Approvals page or by the owner on WhatsApp
 * (worker/owner-approvals.ts). A teammate's run ends when it asks (the task waits as
 * `waiting_approval`, its Claude session saved); the decision queues a continuation
 * that resumes that session. Capability requests are switched on here; the manager
 * then reacts.
 */

export type DecideResult = { ok: true; approval: Approval } | { ok: false; error: string };

/** Short code the owner types on WhatsApp ("ya A7F2"): the first 4 characters of the id. */
export const approvalCode = (a: Pick<Approval, "id">) => a.id.slice(0, 4).toUpperCase();

export function findPendingByCode(businessId: string, code: string) {
  return findByCode(businessId, code).filter((a) => a.status === "pending");
}

/** Every request with this code, whatever its status (to explain a code that's no longer open). */
export function findByCode(businessId: string, code: string) {
  return db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.businessId, businessId), like(schema.approvals.id, `${code.toLowerCase()}%`)))
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

  const granting = pending.toolName === CAPABILITY && p.decision === "approved";
  if (granting) {
    const r = pending.input as CapabilityRequest;
    if (r.kind === "secret" && !p.secretValue?.trim()) {
      return { ok: false, error: `${r.name} is a credential: enter it in the app (Approvals page), never in a chat.` };
    }
  }

  // Only one decision wins (double clicks, the app and WhatsApp at the same time):
  // compare-and-set the status first, and only the winner runs the side effects.
  const decided = db
    .update(schema.approvals)
    .set({ status: p.decision, note, decidedAt: new Date() })
    .where(and(eq(schema.approvals.id, pending.id), eq(schema.approvals.status, "pending")))
    .returning()
    .get();
  if (!decided) return { ok: false, error: "This request was already decided." };

  if (granting) {
    try {
      await grantCapability(decided, { secretValue: p.secretValue, note });
    } catch (err) {
      // Back to pending so the owner can try again (e.g. the Keychain refused).
      db.update(schema.approvals)
        .set({ status: "pending", note: pending.note, decidedAt: null })
        .where(and(eq(schema.approvals.id, decided.id), eq(schema.approvals.status, p.decision)))
        .run();
      return { ok: false, error: (err as Error).message };
    }
  }
  logEvent({
    businessId: p.businessId,
    teammateId: decided.teammateId,
    taskId: decided.taskId,
    type: p.decision === "approved" ? "approval_granted" : "approval_rejected",
    message: `Owner ${p.decision}${p.via === "whatsapp" ? " on WhatsApp" : ""}: ${decided.summary}`,
    data: { approvalId: decided.id, note },
  });
  if (decided.toolName !== CAPABILITY) continueTask(decided);
  reactToDecision(decided, p.via);
  return { ok: true, approval: decided };
}

/**
 * The task that asked is waiting: queue its continuation (the worker resumes the
 * run's Claude session with the decision). A task that's no longer waiting (cancelled,
 * or an old-style run that restarted) just keeps the decision on record.
 */
function continueTask(decided: Approval) {
  if (!decided.taskId) return;
  const task = db
    .update(schema.tasks)
    .set({ status: "queued" })
    .where(and(eq(schema.tasks.id, decided.taskId), eq(schema.tasks.status, "waiting_approval")))
    .returning()
    .get();
  if (!task) return;
  enqueueJob("run_task", { taskId: task.id, approvalId: decided.id });
  db.update(schema.teammates)
    .set({ state: "idle", currentActivity: `Owner ${decided.status}: carrying on` })
    .where(and(eq(schema.teammates.id, task.teammateId), eq(schema.teammates.state, "waiting")))
    .run();
}

/**
 * Worker start: requests left pending by a run that can't be resumed are superseded
 * (that task runs again from scratch and asks afresh). Requests whose task is waiting
 * with a saved session stay open, so an answer the next morning still works.
 * Capability requests don't belong to a running run: they stay too.
 */
export function supersedeStaleApprovals() {
  const open = db
    .select({ id: schema.approvals.id, taskId: schema.approvals.taskId })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.status, "pending"), ne(schema.approvals.toolName, CAPABILITY)))
    .all();
  if (!open.length) return 0;
  const resumable = new Set(
    db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          inArray(schema.tasks.id, [...new Set(open.map((a) => a.taskId).filter((t): t is string => !!t))]),
          eq(schema.tasks.status, "waiting_approval"),
          isNotNull(schema.tasks.sessionId),
        ),
      )
      .all()
      .map((t) => t.id),
  );
  const stale = open.filter((a) => !a.taskId || !resumable.has(a.taskId)).map((a) => a.id);
  if (stale.length) {
    db.update(schema.approvals)
      .set({ status: "superseded", decidedAt: new Date() })
      .where(and(inArray(schema.approvals.id, stale), eq(schema.approvals.status, "pending")))
      .run();
  }
  return stale.length;
}

/**
 * Is this the tool call the owner approved? Same tool and the same arguments (keys in
 * any order, surrounding whitespace ignored): the teammate must do exactly what was
 * shown to the owner, anything else is a new request. `recipientNames` is display-only.
 */
export function sameAction(approval: Pick<Approval, "toolName" | "input">, toolName: string, input: Record<string, unknown>) {
  if (approval.toolName !== toolName) return false;
  return canonical(approval.input) === canonical(input);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => k !== "recipientNames" && o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "string") return JSON.stringify(v.trim());
  return JSON.stringify(v) ?? "null";
}
