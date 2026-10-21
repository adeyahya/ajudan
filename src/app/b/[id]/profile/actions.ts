"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { closeBrowser, ensureBrowser, normalizeSites } from "@/lib/browser";
import { parseLanguage } from "@/lib/language";
import { lines, textToGoals } from "@/lib/onboarding/profile-form";
import { BusinessProfileSchema, type BusinessProfile } from "@/lib/types";
import { initTeammateWorkspace } from "@/lib/workspace";

export type ProfileFormState = { error?: string; ok?: boolean };

export async function saveProfile(businessId: string, _prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz?.profile) return { error: "No profile to edit yet" };

  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const name = str("name") || biz.name;
  const website = str("website") || null;
  const parsed = BusinessProfileSchema.safeParse({
    name,
    website,
    oneLiner: str("oneLiner"),
    description: str("description"),
    products: lines(fd.get("products")),
    targetCustomers: lines(fd.get("targetCustomers")),
    channels: lines(fd.get("channels")),
    brandVoice: str("brandVoice"),
    competitors: lines(fd.get("competitors")),
    goals: textToGoals(fd.get("goals")),
    constraints: lines(fd.get("constraints")),
    teamNeeds: lines(fd.get("teamNeeds")),
  });
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const profile = parsed.data;

  db.update(schema.businesses).set({ profile, name, website }).where(eq(schema.businesses.id, businessId)).run();
  refreshWorkspaces(businessId, profile, biz.language);
  refresh();
  return { ok: true };
}

/** Change the business's primary language; teammates' BUSINESS.md states it. */
export async function saveLanguage(businessId: string, fd: FormData) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  const language = parseLanguage(fd.get("language"));
  db.update(schema.businesses).set({ language }).where(eq(schema.businesses.id, businessId)).run();
  if (biz.profile) refreshWorkspaces(businessId, biz.profile, language);
  refresh();
}

/** Rewrite BUSINESS.md for every active teammate. */
function refreshWorkspaces(businessId: string, profile: BusinessProfile, language: string) {
  const active = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
    .all();
  for (const t of active) {
    const workspaceDir = initTeammateWorkspace(t, profile, language);
    if (workspaceDir !== t.workspaceDir) {
      db.update(schema.teammates).set({ workspaceDir }).where(eq(schema.teammates.id, t.id)).run();
    }
  }
}

/** Show the business's Chrome so the owner can log in to their seller accounts or watch. */
export async function openBusinessBrowser(businessId: string, fd: FormData) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  const url = String(fd.get("url") ?? "").trim() || undefined;
  await ensureBrowser(biz.id, biz.name, url);
  refresh();
}

export async function closeBusinessBrowser(businessId: string) {
  await closeBrowser(businessId);
  refresh();
}

/** Sites the business browser may open (one per line). Empty = no restriction. */
export async function saveBrowserSites(businessId: string, fd: FormData) {
  const browserSites = normalizeSites(String(fd.get("sites") ?? "").split(/[\n,]/));
  db.update(schema.businesses).set({ browserSites }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}
