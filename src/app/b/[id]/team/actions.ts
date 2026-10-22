"use server";

import { and, eq, max } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { enqueueJob } from "@/lib/jobs";
import { isAutonomy, validCron } from "@/lib/onboarding/schedule";
import { HUMAN_ROLE_KEY, normalizePhone } from "@/lib/humans";
import { ensureManager } from "@/lib/manager";
import { isOnWhatsapp } from "@/lib/whatsapp";
import { getRole } from "@/lib/roles";
import { initTeammateWorkspace } from "@/lib/workspace";

export type FormState = { error?: string; ok?: boolean };

function getBiz(businessId: string) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  return biz;
}

const ownTeammate = (businessId: string, teammateId: string) =>
  and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId));

export async function updateTeammate(
  businessId: string,
  teammateId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const autonomy = formData.get("autonomy");
  const rawSchedule = String(formData.get("schedule") ?? "").trim();
  const schedulePrompt = String(formData.get("schedulePrompt") ?? "").trim();
  const browserAccess = formData.get("browserAccess") === "on";
  const whatsappAccess = formData.get("whatsappAccess") === "on";
  const shellAccess = formData.get("shellAccess") === "on";
  if (!name) return { error: "Name can't be empty" };
  if (!isAutonomy(autonomy)) return { error: "Pick an autonomy level" };
  const schedule = rawSchedule ? validCron(rawSchedule) : null;
  if (rawSchedule && !schedule) return { error: `"${rawSchedule}" isn't a valid cron expression (e.g. 0 9 * * 1)` };
  if (schedule && !schedulePrompt) return { error: "Describe what to do on each scheduled run" };

  db.update(schema.teammates)
    .set({ name, autonomy, schedule, schedulePrompt: schedule ? schedulePrompt : null, browserAccess, whatsappAccess, shellAccess })
    .where(ownTeammate(businessId, teammateId))
    .run();
  refresh();
  return { ok: true };
}

export async function removeTeammate(businessId: string, teammateId: string) {
  const t = db.select().from(schema.teammates).where(ownTeammate(businessId, teammateId)).get();
  if (!t) return;
  if (t.status === "proposed") {
    db.delete(schema.teammates).where(ownTeammate(businessId, teammateId)).run();
  } else {
    db.update(schema.teammates).set({ status: "archived" }).where(ownTeammate(businessId, teammateId)).run();
  }
  refresh();
}

export async function redesignTeam(businessId: string) {
  const biz = getBiz(businessId);
  if (biz.busy) return;
  if (!biz.profile) throw new Error("Finish the interview first");
  db.update(schema.businesses).set({ status: "designing", busy: true }).where(eq(schema.businesses.id, businessId)).run();
  enqueueJob("design_team", { businessId });
  refresh();
}

export async function hireTeam(businessId: string) {
  const biz = getBiz(businessId);
  if (!biz.profile) throw new Error("The business profile is missing; finish the interview first");
  const proposed = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "proposed")))
    .all();
  if (!proposed.length) throw new Error("There is no one to hire");

  for (const t of proposed) {
    const workspaceDir = initTeammateWorkspace(t, biz.profile, biz.language);
    db.update(schema.teammates).set({ status: "active", workspaceDir }).where(eq(schema.teammates.id, t.id)).run();
  }
  db.update(schema.businesses).set({ status: "active" }).where(eq(schema.businesses.id, businessId)).run();
  ensureManager(businessId);
  redirect(`/b/${businessId}/manager`);
}

export async function addTeammate(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const biz = getBiz(businessId);
  if (!biz.profile) return { error: "Finish the interview first" };
  const role = getRole(String(formData.get("roleKey") ?? ""));
  if (!role) return { error: "Pick a role" };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your teammate a name" };

  const top = db
    .select({ m: max(schema.teammates.deskIndex) })
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .get();
  const t = db
    .insert(schema.teammates)
    .values({
      businessId,
      name,
      roleKey: role.key,
      title: role.title,
      color: role.color,
      persona: "",
      why: `Added by the owner: ${role.summary}`,
      responsibilities: [role.summary],
      kpis: role.defaultKpis,
      autonomy: "ask",
      status: "active",
      deskIndex: (top?.m ?? -1) + 1,
    })
    .returning()
    .get();
  const workspaceDir = initTeammateWorkspace(t, biz.profile, biz.language);
  db.update(schema.teammates).set({ workspaceDir }).where(eq(schema.teammates.id, t.id)).run();
  refresh();
  return { ok: true };
}

/** A typo'd number would fail silently later: ask WhatsApp now (skipped if WhatsApp isn't linked). */
async function checkNumber(phone: string) {
  return (await isOnWhatsapp(phone)) === false
    ? `+${phone} isn't on WhatsApp. Check the number (with the country code, without the 0 after it).`
    : undefined;
}

function humanFields(formData: FormData, language: string) {
  const name = String(formData.get("name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const helps = String(formData.get("helps") ?? "")
    .split(/\n|;/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!name) return { error: "Give them a name" };
  const phone = normalizePhone(phoneRaw, language);
  if (!phone) return { error: "Enter their WhatsApp number with the country code, e.g. +62 812 3456 7890" };
  return { name, title: title || "Team member", phone, helps };
}

/**
 * Add a real person the AI team can ask for help on WhatsApp (footage, photos,
 * checks). FormData: name, title, phone, helps (one per line).
 */
export async function addHuman(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const biz = getBiz(businessId);
  const f = humanFields(formData, biz.language);
  if ("error" in f) return { error: f.error };
  const taken = db
    .select({ id: schema.teammates.id })
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.phone, f.phone), eq(schema.teammates.status, "active")))
    .get();
  if (taken) return { error: "Someone on the team already has that number" };
  const bad = await checkNumber(f.phone);
  if (bad) return { error: bad };
  const top = db
    .select({ m: max(schema.teammates.deskIndex) })
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .get();
  db.insert(schema.teammates)
    .values({
      businessId,
      kind: "human",
      name: f.name,
      roleKey: HUMAN_ROLE_KEY,
      title: f.title,
      color: "#14b8a6",
      phone: f.phone,
      responsibilities: f.helps,
      kpis: [],
      why: "Added by the owner: a person the team can ask on WhatsApp",
      status: "active",
      deskIndex: (top?.m ?? -1) + 1,
    })
    .run();
  refresh();
  return { ok: true };
}

export async function updateHuman(businessId: string, teammateId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const biz = getBiz(businessId);
  const f = humanFields(formData, biz.language);
  if ("error" in f) return { error: f.error };
  const bad = await checkNumber(f.phone);
  if (bad) return { error: bad };
  db.update(schema.teammates)
    .set({ name: f.name, title: f.title, phone: f.phone, responsibilities: f.helps })
    .where(and(ownTeammate(businessId, teammateId), eq(schema.teammates.kind, "human")))
    .run();
  refresh();
  return { ok: true };
}

/** Mark a person on the team as the owner (approval requests go to their WhatsApp), or unmark. */
export async function setOwnerHuman(businessId: string, humanId: string | null) {
  db.update(schema.businesses).set({ ownerHumanId: humanId }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}
