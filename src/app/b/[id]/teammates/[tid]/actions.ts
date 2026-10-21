"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { createTask } from "@/lib/tasks";

function findTeammate(businessId: string, teammateId: string) {
  const t = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId)))
    .get();
  if (!t) throw new Error("Teammate not found");
  return t;
}

/**
 * Give a teammate a task. Contract used by the office too.
 * FormData: businessId, teammateId, instructions.
 */
export async function assignTask(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const teammateId = String(formData.get("teammateId") ?? "");
  const instructions = String(formData.get("instructions") ?? "").trim();
  if (!businessId || !teammateId || !instructions) throw new Error("Missing fields");
  findTeammate(businessId, teammateId);
  createTask({ businessId, teammateId, instructions, createdBy: "user" });
  refresh();
}

/** Run the teammate's scheduled work now. FormData: businessId, teammateId. */
export async function runScheduledNow(formData: FormData) {
  const businessId = String(formData.get("businessId") ?? "");
  const teammateId = String(formData.get("teammateId") ?? "");
  const t = findTeammate(businessId, teammateId);
  if (!t.schedulePrompt) throw new Error("No scheduled work defined");
  createTask({ businessId, teammateId, instructions: t.schedulePrompt, createdBy: "schedule" });
  refresh();
}

/** Chat entry point: the typed message becomes a task. */
export async function sendTaskMessage(businessId: string, teammateId: string, instructions: string) {
  if (!instructions.trim()) return;
  findTeammate(businessId, teammateId);
  createTask({ businessId, teammateId, instructions: instructions.trim(), createdBy: "user" });
  refresh();
}
