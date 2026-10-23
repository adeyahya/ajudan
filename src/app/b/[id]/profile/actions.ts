"use server";

import { deleteSecret, normalizeHost, setSecret } from "@/lib/secrets";
import { eq } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { closeBrowser, ensureBrowser, normalizeSites } from "@/lib/browser";
import { parseBudget } from "@/lib/budget";
import { t } from "@/lib/i18n";
import { parseLanguage } from "@/lib/language";
import { cancelLink, startLink, unlinkRequestPath, whatsappDir } from "@/lib/whatsapp";
import fs from "node:fs";
import { lines, textToGoals } from "@/lib/onboarding/profile-form";
import { BusinessProfileSchema } from "@/lib/types";
import { refreshWorkspaces } from "@/lib/workspace";
import { connectRepo, disconnectRepo, type RepoError } from "@/lib/repos";
import { EDIT_AREAS, setTeamEdit, type EditArea } from "@/lib/team-edits";

export type ProfileFormState = { error?: string; ok?: boolean };

export async function saveProfile(businessId: string, _prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz?.profile) return { error: t(biz?.language, "profile.err.noProfile") };

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

/**
 * Change the business's primary language: teammates' BUSINESS.md states it, the worker reads it
 * for every prompt, and the app's screens follow it (src/lib/i18n).
 */
export async function saveLanguage(businessId: string, fd: FormData) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  const language = parseLanguage(fd.get("language"));
  db.update(schema.businesses).set({ language }).where(eq(schema.businesses.id, businessId)).run();
  if (biz.profile) refreshWorkspaces(businessId, biz.profile, language);
  revalidatePath(`/b/${businessId}`, "layout"); // nav and the rest of the chrome switch language too
  refresh();
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
  // The browser belongs to the open folder; only close it from that business's page.
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  await closeBrowser();
  refresh();
}

/** Sites the business browser may open (one per line). Empty = no restriction. */
export async function saveBrowserSites(businessId: string, fd: FormData) {
  const browserSites = normalizeSites(String(fd.get("sites") ?? "").split(/[\n,]/));
  db.update(schema.businesses).set({ browserSites }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/** Start linking: the panel then shows wacli's QR code to scan. */
export async function startWhatsappLink(businessId: string) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  startLink();
  refresh();
}

export async function cancelWhatsappLink() {
  cancelLink();
  refresh();
}

/** Ask the worker to log this WhatsApp out (it stops syncing first). */
export async function unlinkWhatsapp(businessId: string) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  fs.mkdirSync(whatsappDir(), { recursive: true });
  fs.writeFileSync(unlinkRequestPath(), new Date().toISOString());
  db.update(schema.businesses).set({ whatsappChats: [] }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/** Which groups/communities teammates may read and post in. Checkbox values are "jid|name". */
export async function saveWhatsappChats(businessId: string, fd: FormData) {
  const whatsappChats = fd
    .getAll("chat")
    .map(String)
    .map((v) => {
      const i = v.indexOf("|");
      return { jid: v.slice(0, i), name: v.slice(i + 1) };
    })
    .filter((c) => c.jid.endsWith("@g.us") || c.jid.endsWith("@s.whatsapp.net") || c.jid.endsWith("@newsletter"));
  db.update(schema.businesses).set({ whatsappChats }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/** Store or update a credential (value → Keychain). FormData: name, value, hosts, note. */
export async function saveSecretAction(businessId: string, _prev: { error?: string; ok?: string }, fd: FormData) {
  try {
    const name = await setSecret({
      businessId,
      name: String(fd.get("name") ?? ""),
      value: String(fd.get("value") ?? ""),
      hosts: String(fd.get("hosts") ?? "").split(/[\n,\s]+/),
      note: String(fd.get("note") ?? "").trim(),
    });
    refresh();
    return { ok: t(String(fd.get("lang") ?? ""), "profile.secrets.saved", { name, usage: `{{secret.${name}}}` }) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function deleteSecretAction(businessId: string, name: string) {
  await deleteSecret(businessId, name);
  refresh();
}

/** The optional daily usage cap (0 = none); queued work waits once it's reached. */
export async function saveDailyBudget(businessId: string, fd: FormData) {
  const dailyBudgetUsd = parseBudget(fd.get("budget"));
  if (dailyBudgetUsd === null) {
    const biz = db.select({ language: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
    throw new Error(t(biz?.language, "profile.err.budget"));
  }
  db.update(schema.businesses).set({ dailyBudgetUsd }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/** Domains the teammates' sandboxed shell may reach. */
export async function saveNetworkDomains(businessId: string, fd: FormData) {
  const networkDomains = [
    ...new Set(
      String(fd.get("domains") ?? "")
        .split(/[\n,\s]+/)
        .map(normalizeHost)
        .filter((d): d is string => !!d),
    ),
  ];
  db.update(schema.businesses).set({ networkDomains }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/** Connect a local git repository (its folder path). Returns the problem instead of throwing, so the owner sees it. */
export async function connectRepository(businessId: string, dir: string): Promise<{ error: RepoError } | { name: string }> {
  if (!db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()) throw new Error("Business not found");
  const r = await connectRepo(businessId, dir);
  if ("error" in r) return r;
  refresh();
  return { name: r.repo.name };
}

export async function disconnectRepository(businessId: string, repoId: string) {
  disconnectRepo(businessId, repoId);
  refresh();
}

/** Business → Team permissions: let the AI team change an area by itself, or not. */
export async function setTeamEditAction(businessId: string, area: EditArea, on: boolean) {
  const biz = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  if (!EDIT_AREAS.includes(area)) throw new Error("Unknown area");
  setTeamEdit(businessId, area, on === true);
  refresh();
}
