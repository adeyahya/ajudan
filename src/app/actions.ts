"use server";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { folderInfo, forgetFolder, isBusinessFolder, setActiveFolder, suggestFolder } from "@/lib/folders";
import { parseLanguage } from "@/lib/language";

export type FolderFormState = { error?: string };

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

function routeFor(businessId: string, status: string | null) {
  if (status === "onboarding") return `/b/${businessId}/onboarding`;
  if (status === "active") return `/b/${businessId}/manager`;
  return `/b/${businessId}/team`;
}

/** New business = new folder. Opens it, then starts the interview. */
export async function createBusiness(_prev: FolderFormState, formData: FormData): Promise<FolderFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the business a name" };
  const website = normalizeWebsite(String(formData.get("website") ?? ""));
  const language = parseLanguage(formData.get("language"));
  const dir = expandPath(String(formData.get("folder") ?? "")) || suggestFolder(name);
  if (isBusinessFolder(dir)) return { error: `${dir} already holds a business. Open it instead.` };
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) return { error: `${dir} is a file, not a folder` };

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
  if (!dir) return { error: "Type the folder's path" };
  if (!fs.existsSync(dir)) return { error: `${dir} doesn't exist` };
  if (!isBusinessFolder(dir)) return { error: `${dir} has no ajudan.db, so it isn't a business folder` };
  getDb(dir); // upgrade its schema if it came from an older version
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
