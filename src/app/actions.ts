"use server";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { folderInfo, forgetFolder, isBusinessFolder, rememberFolder, setActiveFolder, suggestFolder } from "@/lib/folders";
import { IN_APP, routeFor } from "@/lib/app-mode";
import { parseLanguage } from "@/lib/language";
import { t, uiLang } from "@/lib/i18n";

/** openDir: in the desktop app, the folder to open in a new window. */
export type FolderFormState = { error?: string; openDir?: string };

function normalizeWebsite(raw: string) {
  const w = raw.trim();
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

/** "~/Ajudan/Shop" → absolute path. */
function expandPath(raw: string) {
  const p = raw.trim();
  if (!p) return "";
  return path.resolve(p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);
}


/** New business = new folder. Opens it, then starts the interview. */
export async function createBusiness(_prev: FolderFormState, formData: FormData): Promise<FolderFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const language = parseLanguage(formData.get("language"));
  const lang = uiLang(String(formData.get("lang") ?? "")); // the UI language the form was shown in
  if (!name) return { error: t(lang, "home.err.name") };
  const website = normalizeWebsite(String(formData.get("website") ?? ""));
  const dir = expandPath(String(formData.get("folder") ?? "")) || suggestFolder(name);
  if (isBusinessFolder(dir)) return { error: t(lang, "home.err.exists", { dir }) };
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) return { error: t(lang, "home.err.isFile", { dir }) };

  fs.mkdirSync(dir, { recursive: true });
  const db = getDb(dir); // creates ajudan.db with the current schema
  const biz = db
    .insert(schema.businesses)
    .values({ name, website, language, status: "onboarding", busy: true })
    .returning({ id: schema.businesses.id })
    .get();
  try {
    db.insert(schema.jobs).values({ kind: "onboarding_turn", payload: { businessId: biz.id } }).run();
  } catch (err) {
    db.update(schema.businesses).set({ busy: false }).where(eq(schema.businesses.id, biz.id)).run();
    throw err;
  }
  // Desktop app: the new business opens in its own window (and lands on the interview).
  if (IN_APP) {
    rememberFolder(dir);
    revalidatePath("/", "layout");
    return { openDir: dir };
  }
  setActiveFolder(dir);
  revalidatePath("/", "layout"); // header shows the open business
  redirect(`/b/${biz.id}/onboarding`);
}

/** Switch to a business folder from the list. */
export async function openFolder(dir: string) {
  if (!isBusinessFolder(dir)) throw new Error(`${dir} is not an Ajudan business folder`);
  setActiveFolder(dir);
  revalidatePath("/", "layout");
  const info = folderInfo(dir);
  redirect(info.businessId ? routeFor(info.businessId, info.status) : "/");
}

/** Open a business folder by typing its path (e.g. a copy from another laptop). */
export async function openFolderByPath(_prev: FolderFormState, formData: FormData): Promise<FolderFormState> {
  const dir = expandPath(String(formData.get("path") ?? ""));
  const lang = uiLang(String(formData.get("lang") ?? "")); // the UI language the form was shown in
  if (!dir) return { error: t(lang, "home.err.path") };
  if (!fs.existsSync(dir)) return { error: t(lang, "home.err.missing", { dir }) };
  if (!isBusinessFolder(dir)) return { error: t(lang, "home.err.notBusiness", { dir }) };
  getDb(dir); // upgrade its schema if it came from an older version
  if (IN_APP) {
    rememberFolder(dir);
    revalidatePath("/", "layout");
    return { openDir: dir };
  }
  setActiveFolder(dir);
  revalidatePath("/", "layout");
  const info = folderInfo(dir);
  redirect(info.businessId ? routeFor(info.businessId, info.status) : "/");
}

/** Remove from the list. The folder and its files stay on disk. */
export async function forgetFolderAction(dir: string) {
  forgetFolder(dir);
  revalidatePath("/", "layout");
  redirect("/");
}
