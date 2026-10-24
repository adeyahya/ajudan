"use server";

import { backendKey, deleteSecret, normalizeHost, setBackendKey, setSecret } from "@/lib/secrets";
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
import { setSupervised } from "@/lib/supervision";
import { ACCESS_LEVELS, AGENT_COLLECTIONS, setAgentAccess, type AccessLevel, type AgentCollection } from "@/lib/agent-access";
import { backendOf, isProvider, PROVIDER_DEFAULTS, type BackendSettings, type ModelOption, type Provider } from "@/lib/backend";
import { claudeModels, ollamaModels, openRouterModels } from "@/lib/model-catalog";
import path from "node:path";
import { isLibraryPath } from "@/lib/assets";
import { mediaKind } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { transcribe } from "@/lib/speech";
import { speak, voiceAvailable } from "@/lib/voice";
import { VOICE_ATTRS, VOICE_MODES, voiceSettings, type VoiceMode, type VoiceSettings } from "@/lib/voice-settings";

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

/** Business → Permissions → What teammates can do: one workspace collection's access (src/lib/agent-access.ts). */
export async function setAgentAccessAction(businessId: string, collection: AgentCollection, level: AccessLevel) {
  const biz = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  if (!AGENT_COLLECTIONS.includes(collection) || !ACCESS_LEVELS.includes(level)) throw new Error("Unknown access");
  setAgentAccess(businessId, { [collection]: level });
  refresh();
}

/** Supervised mode: every change the team makes waits for the owner (src/lib/supervision.ts). */
export async function setSupervisedAction(businessId: string, on: boolean) {
  const biz = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  setSupervised(businessId, on === true);
  refresh();
}

/** Business → AI backend: provider, endpoint and models; the key goes to the Keychain. */
export async function saveBackendAction(businessId: string, fd: FormData) {
  const biz = db.select({ id: schema.businesses.id, language: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  const provider = fd.get("provider");
  if (!isProvider(provider)) throw new Error(t(biz.language, "profile.backend.err.provider"));
  const str = (k: string) => String(fd.get(k) ?? "").trim() || undefined;
  const baseUrl = str("baseUrl");
  if (baseUrl && !/^https?:\/\/[^\s]+$/.test(baseUrl)) throw new Error(t(biz.language, "profile.backend.err.url"));
  const key = str("apiKey");
  if (key) await setBackendKey(businessId, key);
  if (PROVIDER_DEFAULTS[provider].needsKey && !key && !(await backendKey(businessId))) throw new Error(t(biz.language, "profile.backend.err.key"));
  const models = { mainModel: str("mainModel"), fastModel: str("fastModel") };
  const route = String(fd.get("route") ?? "pick");
  const settings: BackendSettings =
    provider === "claude"
      ? { provider, ...models }
      : provider === "openrouter"
        ? { provider, baseUrl, ...models, route: route === "free" || route === "auto" ? route : "pick", fallbackToFree: fd.get("fallbackToFree") === "on" }
        : { provider, baseUrl, ...models };
  db.update(schema.businesses).set({ aiBackend: settings }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/**
 * Check the saved backend answers: Ollama is running and has the models, OpenRouter
 * accepts the key. Only reads; no tokens spent.
 */
export async function testBackendAction(businessId: string): Promise<{ ok: boolean; message: string }> {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  const lang = biz.language;
  const b = backendOf(biz.aiBackend);
  try {
    if (b.provider === "ollama") {
      const res = await fetch(`${b.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, message: t(lang, "profile.backend.test.http", { status: String(res.status) }) };
      const have = ((await res.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [];
      const missing = [...new Set([b.mainModel, b.fastModel])].filter((m) => !have.includes(m) && !have.includes(`${m}:latest`));
      return missing.length
        ? { ok: false, message: t(lang, "profile.backend.test.missing", { models: missing.join(", "), cmd: `ollama pull ${missing[0]}` }) }
        : { ok: true, message: t(lang, "profile.backend.test.ok") };
    }
    if (b.provider === "openrouter") {
      const key = await backendKey(businessId);
      if (!key) return { ok: false, message: t(lang, "profile.backend.err.key") };
      const res = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, message: t(lang, "profile.backend.test.http", { status: String(res.status) }) };
      // The chosen models exist and can call tools (teammates need them).
      const catalog = new Map((await openRouterModels()).map((m) => [m.id, m]));
      const wanted = [...new Set([b.mainModel, b.fastModel])];
      const unknown = wanted.filter((m) => !catalog.has(m));
      if (unknown.length) return { ok: false, message: t(lang, "profile.backend.test.unknownModel", { models: unknown.join(", ") }) };
      const noTools = wanted.filter((m) => !catalog.get(m)?.tools);
      if (noTools.length) return { ok: false, message: t(lang, "profile.backend.test.noTools", { models: noTools.join(", ") }) };
      return { ok: true, message: t(lang, "profile.backend.test.ok") };
    }
    return { ok: true, message: t(lang, "profile.backend.test.claude") };
  } catch {
    return { ok: false, message: t(lang, "profile.backend.test.unreachable", { url: b.baseUrl }) };
  }
}

/**
 * Models for the picker on Business → AI backend. Ollama is asked at `baseUrl` (the
 * field as typed, so a new address works before saving). Only reads catalogs.
 */
export async function listModelsAction(businessId: string, provider: Provider, baseUrl?: string): Promise<{ models: ModelOption[]; error?: string }> {
  const biz = db.select({ language: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  try {
    if (provider === "claude") return { models: claudeModels() };
    if (provider === "openrouter") return { models: await openRouterModels() };
    const url = baseUrl && /^https?:\/\/[^\s]+$/.test(baseUrl) ? baseUrl : undefined;
    return { models: await ollamaModels(backendOf({ provider: "ollama", baseUrl: url })) };
  } catch {
    return { models: [], error: t(biz.language, provider === "ollama" ? "profile.backend.picker.ollamaDown" : "profile.backend.picker.catalogDown") };
  }
}

/**
 * Business → WhatsApp → Voice replies. A clip to clone is transcribed once (whisper.cpp)
 * so OmniVoice knows what it says.
 */
export async function saveVoiceAction(businessId: string, fd: FormData) {
  const biz = db.select({ language: schema.businesses.language, v: schema.businesses.voiceReplies }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  const mode = String(fd.get("mode") ?? "off") as VoiceMode;
  if (!VOICE_MODES.includes(mode)) throw new Error("Unknown mode");
  const instruct = (["gender", "age", "pitch"] as const)
    .map((k) => String(fd.get(k) ?? ""))
    .filter((v) => (Object.values(VOICE_ATTRS) as readonly (readonly string[])[]).some((list) => list.includes(v)))
    .join(", ");
  const ref = fd.get("source") === "clone" ? String(fd.get("refAudio") ?? "") : "";
  if (ref && (!isLibraryPath(ref) || mediaKind(ref) !== "audio" || !fs.existsSync(path.join(dataDir(), ref)))) throw new Error(t(biz.language, "profile.voice.err.clip"));
  let refText = ref && ref === biz.v?.refAudio ? biz.v.refText : undefined;
  if (ref && !refText) {
    const tr = await transcribe(path.join(dataDir(), ref), { language: biz.language });
    refText = tr.text.trim();
    if (!refText) throw new Error(t(biz.language, "profile.voice.err.silent"));
  }
  const settings: VoiceSettings = { mode, instruct: instruct || undefined, ...(ref ? { refAudio: ref, refText } : {}) };
  db.update(schema.businesses).set({ voiceReplies: settings }).where(eq(schema.businesses.id, businessId)).run();
  refresh();
}

/** Say a sample sentence in the saved voice; returns a URL to play it. */
export async function previewVoiceAction(businessId: string): Promise<{ url?: string; error?: string }> {
  const biz = db.select({ language: schema.businesses.language, v: schema.businesses.voiceReplies }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) throw new Error("Business not found");
  if (!voiceAvailable()) return { error: t(biz.language, "profile.voice.notSetUp") };
  try {
    const rel = await speak(t(biz.language, "profile.voice.sample"), voiceSettings(biz.v), biz.language);
    return { url: `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
