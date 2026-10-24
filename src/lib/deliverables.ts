import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Deliverable, DeliverableVersion } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { MANAGER_ROLE } from "@/lib/roles";
import { syncDeliverableFile } from "@/lib/workfiles";

/**
 * Revising a deliverable in place (update_deliverable in worker/tools.ts): the row keeps
 * its id, so the owner's feedback, the revision task and the work/ file stay attached,
 * and what it held before goes into `versions`.
 */

/** Earlier versions kept per deliverable; older ones fall off the front. */
export const MAX_VERSIONS = 10;

/** `versions` with the row's current state added at the end, bounded. */
export function pushVersion(
  d: Pick<Deliverable, "title" | "content" | "attachments" | "versions">,
  by: string | null,
  now = new Date(),
): DeliverableVersion[] {
  return [...d.versions, { title: d.title, content: d.content, attachments: d.attachments, savedAt: now.toISOString(), byTeammateId: by }].slice(
    -MAX_VERSIONS,
  );
}

/** Why `who` may not change this deliverable, or null: its maker and the manager may. */
export function rejectRevision(d: Pick<Deliverable, "teammateId" | "status">, who: { id: string; roleKey: string }): string | null {
  if (d.status === "published") return "it was already posted by the owner; save a new deliverable instead";
  if (d.teammateId && d.teammateId !== who.id && who.roleKey !== MANAGER_ROLE.key) return "it belongs to another teammate; ask them, or the manager";
  return null;
}

export type Revision = { title?: string; content?: string; attachments?: string[] };

/**
 * Replace the content, title or attachments of a deliverable, keeping the previous
 * version. The status goes back to "draft": the owner (or the manager) looks again,
 * and the teammate marks it ready to post when it is.
 */
export function reviseDeliverable(p: { businessId: string; deliverableId: string; by: { id: string; name: string; roleKey: string }; taskId?: string | null } & Revision) {
  const d = db
    .select()
    .from(schema.deliverables)
    .where(and(eq(schema.deliverables.id, p.deliverableId), eq(schema.deliverables.businessId, p.businessId), isNull(schema.deliverables.deletedAt)))
    .get();
  if (!d) return { ok: false as const, error: `No deliverable with id ${p.deliverableId} in this business.` };
  const why = rejectRevision(d, p.by);
  if (why) return { ok: false as const, error: `Can't change "${d.title}": ${why}.` };
  if (p.title === undefined && p.content === undefined && p.attachments === undefined) return { ok: false as const, error: "Nothing to change." };
  const updated = db
    .update(schema.deliverables)
    .set({
      title: p.title ?? d.title,
      content: p.content ?? d.content,
      attachments: p.attachments ?? d.attachments,
      versions: pushVersion(d, p.by.id),
      status: "draft",
    })
    .where(eq(schema.deliverables.id, d.id))
    .returning()
    .get()!;
  syncDeliverableFile(d.id);
  logEvent({
    businessId: p.businessId,
    teammateId: p.by.id,
    taskId: p.taskId ?? null,
    type: "deliverable_revised",
    message: `${p.by.name} revised "${updated.title}" (version ${updated.versions.length + 1})`,
    data: { deliverableId: d.id, version: updated.versions.length + 1 },
  });
  return { ok: true as const, deliverable: updated };
}

/** A deliverable as a teammate reads it: everything, so it can be reviewed or revised. */
export function describeDeliverable(d: Deliverable, teammateName?: string | null) {
  const head = [
    `# ${d.title}`,
    `id: ${d.id}`,
    `kind: ${d.kind}${d.channel ? ` · channel: ${d.channel}` : ""} · status: ${d.status}${teammateName ? ` · by ${teammateName}` : ""}`,
    `version: ${d.versions.length + 1}${d.versions.length ? ` (${d.versions.length} earlier)` : ""}`,
    d.attachments.length ? `attachments:\n${d.attachments.map((a) => `- ${a}`).join("\n")}` : "attachments: none",
  ];
  return `${head.join("\n")}\n\n${d.content}`;
}
