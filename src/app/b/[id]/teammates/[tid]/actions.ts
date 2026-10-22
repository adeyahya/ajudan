"use server";

import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { isServablePath } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { cancelTask, createTask, retryTask } from "@/lib/tasks";

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

/** Stop a task that's queued, running or waiting. FormData: businessId, taskId. */
export async function cancelTaskAction(formData: FormData) {
  cancelTask(String(formData.get("businessId") ?? ""), String(formData.get("taskId") ?? ""));
  refresh();
}

/** Run a failed or cancelled task again. FormData: businessId, taskId. */
export async function retryTaskAction(formData: FormData) {
  retryTask(String(formData.get("businessId") ?? ""), String(formData.get("taskId") ?? ""));
  refresh();
}

/** Chat entry point: the typed message (and any files dropped in) becomes a task. */
export async function sendTaskMessage(businessId: string, teammateId: string, instructions: string, attachments: string[] = []) {
  const files = attachments.filter((f) => isServablePath(f) && fs.existsSync(path.join(dataDir(), f)));
  if (!instructions.trim() && !files.length) return;
  findTeammate(businessId, teammateId);
  createTask({
    businessId,
    teammateId,
    instructions: instructions.trim() || "(See the attached files.)",
    createdBy: "user",
    attachments: files,
  });
  refresh();
}
