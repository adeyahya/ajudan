"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { createTask } from "@/lib/tasks";

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
