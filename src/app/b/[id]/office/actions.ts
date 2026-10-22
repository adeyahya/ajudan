"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { getManager } from "@/lib/manager";
import { t } from "@/lib/i18n";
import { createTask } from "@/lib/tasks";

/**
 * The office's "Give a task": like a message to the manager (the owner's single
 * point of contact), with the teammate the owner picked as a hint. The manager
 * briefs that teammate, or someone better suited, and reports back in its chat.
 * FormData: businessId, teammateId, instructions, lang (the UI language, for errors).
 */
export async function giveTask(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const teammateId = String(formData.get("teammateId") ?? "");
  const instructions = String(formData.get("instructions") ?? "").trim();
  const lang = String(formData.get("lang") ?? "");
  if (!businessId || !teammateId || !instructions) throw new Error(t(lang, "office.task.missing"));
  const picked = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .get();
  if (!picked) throw new Error(t(lang, "office.task.notFound"));
  const manager = getManager(businessId);
  if (!manager || manager.id === picked.id) {
    createTask({ businessId, teammateId: picked.id, instructions, createdBy: "user" });
  } else {
    createTask({
      businessId,
      teammateId: manager.id,
      instructions: `${instructions}\n\n(The owner picked ${picked.name} (${picked.title}) for this in the office. Brief ${picked.name} unless someone else clearly fits better.)`,
      createdBy: "user",
    });
  }
  refresh();
  return manager && manager.id !== picked.id ? manager.name : null;
}
