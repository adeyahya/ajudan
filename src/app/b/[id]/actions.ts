"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { createTask } from "@/lib/tasks";
import { addLink, describeRef, findLinkTargets, linksFor, OBJECT_TYPES, removeLink, type ObjectRef, type RefInfo } from "@/lib/links";
import { actorResolver, canRestoreEntry, getHistoryEntry, historyFor, restoreVersion, type Actor, type HistoryAction } from "@/lib/object-history";
import { restoreFromTrash, softDelete, TRASH_TYPES, type TrashType } from "@/lib/trash";

/** Server Functions shared by several areas of a business (workspace pages, Studio). */

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

/**
 * Hand work to a teammate with files ("Ask a teammate" on docs, library files, contacts
 * and the Studio; src/components/plan-task.tsx). While the team rests it waits in the
 * queue and starts when they're back.
 */
export async function planTask(businessId: string, teammateId: string, instructions: string, attachments: string[] = []) {
  ownBusiness(businessId);
  const mate = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .get();
  if (!mate) return { error: "Pick a teammate." };
  if (!instructions.trim()) return { error: "Say what you'd like done." };
  const task = createTask({ businessId, teammateId, instructions, createdBy: "user", attachments: attachments.filter((p) => /^(media|work)\//.test(p)) });
  logEvent({ businessId, teammateId, taskId: task.id, type: "studio_planned", message: `You planned "${task.title}" for ${mate.name} from the Studio` });
  refresh();
  return { ok: `Queued for ${mate.name}: "${task.title}"` };
}

export type ObjectPanelLink = RefInfo & { direction: "out" | "in"; createdBy: string; linkId: string };
export type ObjectPanelHistory = { id: string; action: HistoryAction; by: string; actor: Actor; createdAt: number; canRestore: boolean };
export type ObjectPanelData = { links: ObjectPanelLink[]; history: ObjectPanelHistory[] };

const isRef = (r: unknown): r is ObjectRef =>
  !!r && typeof r === "object" && OBJECT_TYPES.includes((r as ObjectRef).type) && typeof (r as ObjectRef).id === "string" && !!(r as ObjectRef).id;

/**
 * What the shared object panel shows for one doc, deliverable, asset or contact
 * (src/components/object-panel.tsx): its links in both directions and its history.
 */
export async function loadObjectPanel(businessId: string, ref: ObjectRef): Promise<ObjectPanelData> {
  ownBusiness(businessId);
  if (!isRef(ref)) throw new Error("Unknown object");
  const links = linksFor(businessId, ref).flatMap((l) => {
    const info = describeRef(businessId, l);
    return info ? [{ ...info, direction: l.direction, createdBy: l.createdBy, linkId: l.linkId }] : [];
  });
  const actor = actorResolver(businessId);
  const history = historyFor(businessId, ref.type, ref.id, 50).map((h) => ({
    id: h.id,
    action: h.action,
    by: h.by,
    actor: actor(h.by),
    createdAt: h.createdAt.getTime(),
    canRestore: canRestoreEntry(h),
  }));
  return { links, history };
}

/** Link picker: objects whose title or text matches `query`, leaving out `exclude` (the object itself). */
export async function searchLinkTargets(businessId: string, query: string, exclude?: ObjectRef): Promise<RefInfo[]> {
  ownBusiness(businessId);
  return findLinkTargets(businessId, String(query ?? "")).filter((r) => !(exclude && r.type === exclude.type && r.id === exclude.id));
}

/** The owner links `from` → `to` from the object panel. */
export async function linkObjects(businessId: string, from: ObjectRef, to: ObjectRef) {
  ownBusiness(businessId);
  if (!isRef(from) || !isRef(to) || !describeRef(businessId, to)) return { error: "Not found" };
  addLink(businessId, from, to, "owner");
  refresh();
  return { ok: true as const };
}

/** Remove a link from the panel; `direction` "in" removes the backlink (other → this). */
export async function unlinkObjects(businessId: string, ref: ObjectRef, other: ObjectRef, direction: "out" | "in") {
  ownBusiness(businessId);
  if (!isRef(ref) || !isRef(other)) return { error: "Not found" };
  const removed = direction === "in" ? removeLink(businessId, other, ref) : removeLink(businessId, ref, other);
  refresh();
  return removed ? { ok: true as const } : { error: "Not found" };
}

/** "Restore this version" in the object panel's History. */
export async function restoreObjectVersion(businessId: string, historyId: string) {
  ownBusiness(businessId);
  const ok = restoreVersion(businessId, String(historyId), "owner");
  refresh();
  return ok ? { ok: true as const } : { error: "Can't restore this version" };
}

/**
 * Undo a teammate's change (Inbox → Recent changes by the team): an update goes back to
 * the snapshot from before it, something they made goes to Trash, something they deleted
 * comes back out of it.
 */
export async function undoTeamChange(businessId: string, historyId: string) {
  ownBusiness(businessId);
  const e = getHistoryEntry(businessId, String(historyId));
  if (!e || !e.by.startsWith("teammate:")) return { error: "Change not found" };
  let ok = false;
  if (e.action === "update") ok = restoreVersion(businessId, e.id, "owner", "before");
  else if ((TRASH_TYPES as string[]).includes(e.objectType)) {
    const type = e.objectType as TrashType;
    if (e.action === "create") ok = softDelete(businessId, type, e.objectId, "owner");
    else if (e.action === "delete") ok = restoreFromTrash(businessId, type, e.objectId, "owner");
  }
  refresh();
  return ok ? { ok: true as const } : { error: "Can't undo this change" };
}
