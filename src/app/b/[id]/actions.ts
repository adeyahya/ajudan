"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { createTask } from "@/lib/tasks";
import { describeRef, linksFor, type ObjectRef, type RefInfo } from "@/lib/links";
import { historyFor } from "@/lib/object-history";

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

export type ObjectPanelData = {
  links: (RefInfo & { direction: "out" | "in"; createdBy: string })[];
  history: { id: string; action: string; by: string; createdAt: number }[];
};

/**
 * What the shared object panel shows for one doc, deliverable, asset or contact
 * (src/components/object-panel.tsx): its links in both directions and its history.
 */
export async function loadObjectPanel(businessId: string, ref: ObjectRef): Promise<ObjectPanelData> {
  ownBusiness(businessId);
  const links = linksFor(businessId, ref).flatMap((l) => {
    const info = describeRef(businessId, l);
    return info ? [{ ...info, direction: l.direction, createdBy: l.createdBy }] : [];
  });
  const history = historyFor(businessId, ref.type, ref.id, 50).map((h) => ({ id: h.id, action: h.action, by: h.by, createdAt: h.createdAt.getTime() }));
  return { links, history };
}
