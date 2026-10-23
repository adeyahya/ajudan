"use server";

import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { ContextSection, ReaderMode } from "@/db/schema";
import { deleteContact, saveContact, type ContactInput } from "@/lib/contacts";
import { createPage, decideSuggestion, deletePage, movePage, SECTIONS, setReaderMode, updatePage } from "@/lib/context";
import { MEMORY_FORCE_MIN_BYTES } from "@/lib/memory";
import { resolveWorkspace } from "@/lib/paths";
import { pendingReorganize, requestReorganize, setReorganizeSchedule } from "@/lib/reorganize";
import { t } from "@/lib/i18n";
import { enqueueJob } from "@/lib/jobs";
import { ensureManager } from "@/lib/manager";
import { createTask } from "@/lib/tasks";

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

const MODES: ReaderMode[] = ["always", "when_needed", "never"];

/**
 * The editor's autosave: markdown for the team, the editor's blocks to round-trip.
 * No refresh: the page on screen is already what was saved.
 */
export async function savePageAction(businessId: string, pageId: string, v: { title?: string; body?: string; blocks?: unknown[] }) {
  ownBusiness(businessId);
  const row = updatePage(businessId, pageId, v);
  return row ? { ok: true as const, updatedAt: row.updatedAt?.toISOString() ?? null } : { error: "not_found" as const };
}

export async function renamePageAction(businessId: string, pageId: string, title: string) {
  ownBusiness(businessId);
  updatePage(businessId, pageId, { title });
  refresh();
}

/** The page's icon: an emoji, "lucide:<name>", "" for none, or null for the default. */
export async function setIconAction(businessId: string, pageId: string, icon: string | null) {
  ownBusiness(businessId);
  updatePage(businessId, pageId, { icon });
  refresh();
}

/** The page's cover: a folder-relative image ("media/…") or null to remove it. */
export async function setCoverAction(businessId: string, pageId: string, cover: string | null) {
  ownBusiness(businessId);
  updatePage(businessId, pageId, { cover });
  refresh();
}

/**
 * Drag and drop in the tree (and "Move to"): under `parentId` (null: the top of
 * `section`) at `index` among the new siblings. False when the move isn't allowed.
 */
export async function movePageAction(businessId: string, pageId: string, to: { parentId: string | null; section?: ContextSection; index?: number }) {
  ownBusiness(businessId);
  if (to.section && !SECTIONS.includes(to.section)) throw new Error("Unknown section");
  const ok = movePage(businessId, pageId, to);
  refresh();
  return ok;
}

export async function markCheckedAction(businessId: string, pageId: string) {
  ownBusiness(businessId);
  updatePage(businessId, pageId, { checked: true });
  refresh();
}

/**
 * A new page in a section, or under `parentId` (it then takes the parent's section);
 * returns its id for the URL. The sidebar and the ⌘K palette call it with three arguments;
 * `kind` "mindmap" makes a mind map instead.
 */
export async function createPageAction(businessId: string, section: ContextSection, title: string, parentId?: string | null, kind: "page" | "mindmap" = "page") {
  ownBusiness(businessId);
  if (!SECTIONS.includes(section)) throw new Error("Unknown section");
  if (kind !== "page" && kind !== "mindmap") throw new Error("Unknown kind");
  const id = createPage(businessId, { title, section, kind, parentId: parentId ?? null }).id;
  refresh();
  return id;
}

export async function deletePageAction(businessId: string, pageId: string) {
  ownBusiness(businessId);
  const ok = deletePage(businessId, pageId);
  refresh();
  return ok;
}

export async function setReaderAction(businessId: string, pageId: string, teammateId: string, mode: ReaderMode) {
  ownBusiness(businessId);
  if (!MODES.includes(mode)) throw new Error("Unknown mode");
  setReaderMode(businessId, pageId, teammateId, mode);
  refresh();
}

/** Accept (with the owner's edited text, if any) or reject a teammate's suggestion. */
export async function decideSuggestionAction(businessId: string, suggestionId: string, accept: boolean, body?: string) {
  ownBusiness(businessId);
  const r = decideSuggestion(businessId, suggestionId, accept, body);
  refresh();
  return r;
}

/** The person peek: a new person (no id) or an edit. Returns the id. */
export async function saveContactAction(businessId: string, input: ContactInput & { id?: string }) {
  ownBusiness(businessId);
  const r = saveContact(businessId, input);
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const, id: r.contact.id };
}

export async function deleteContactAction(businessId: string, contactId: string) {
  ownBusiness(businessId);
  deleteContact(businessId, contactId);
  refresh();
}

/** "Ask <teammate> to follow up": a request to the manager, who hands it on. */
export async function followUpAction(businessId: string, contactId: string, teammateId: string, note: string) {
  ownBusiness(businessId);
  const contact = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.businessId, businessId))).get();
  const mate = db.select().from(schema.teammates).where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId))).get();
  const manager = ensureManager(businessId);
  if (!contact || !mate || !manager) return { error: "not_found" as const };
  const who = `${contact.name}${contact.company ? ` (${contact.company})` : ""}${contact.phone ? `, +${contact.phone}` : ""}`;
  const lang = db.select({ l: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.l;
  // The owner's own message in their chat with the manager, so in their language.
  const ask = mate.id === manager.id ? t(lang, "context.peek.taskSelf", { who }) : t(lang, "context.peek.taskOther", { name: mate.name, who });
  const instructions = `${ask}${note.trim() ? `\n\n${note.trim()}` : ""}`;
  createTask({ businessId, teammateId: manager.id, instructions, createdBy: "user" });
  refresh();
  return { ok: true as const, manager: manager.name, managerId: manager.id };
}

/** The inspector's dry run: queued for the worker (all Claude calls happen there). */
export async function testAskAction(businessId: string, teammateId: string, question: string) {
  ownBusiness(businessId);
  const q = question.trim().slice(0, 2000);
  if (!q) return;
  const mate = db.select({ id: schema.teammates.id }).from(schema.teammates).where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId))).get();
  if (!mate) return;
  const ask = db.insert(schema.contextAsks).values({ businessId, teammateId, question: q }).returning().get();
  enqueueJob("context_test_ask", { askId: ask.id });
  refresh();
}

/** "Reorganize with AI": queue the review (the worker runs it). False when one is already waiting or running. */
export async function reorganizeAction(businessId: string) {
  ownBusiness(businessId);
  const queued = requestReorganize(businessId) !== null;
  refresh();
  return queued;
}

export async function setReorganizeWeeklyAction(businessId: string, weekly: boolean) {
  ownBusiness(businessId);
  setReorganizeSchedule(businessId, weekly);
  refresh();
}

/** Accept or reject every pending suggestion from the review, in order. Returns how many went through. */
export async function decideAllReorganizeAction(businessId: string, accept: boolean) {
  ownBusiness(businessId);
  let done = 0;
  let failed = 0;
  for (const s of pendingReorganize(businessId)) {
    // An earlier step may have removed this page (a merge): its suggestion went with it.
    const r = decideSuggestion(businessId, s.id, accept);
    if ("ok" in r) done++;
    else if (r.error !== "already_decided") failed++;
  }
  refresh();
  return { done, failed };
}

/** "Tidy memory now": rewrite each AI teammate's memory.md into sections (worker/handlers/memory.ts). */
export async function tidyMemoryAction(businessId: string) {
  ownBusiness(businessId);
  const mates = db.select().from(schema.teammates).where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active"), eq(schema.teammates.kind, "ai"))).all();
  let count = 0;
  for (const m of mates) {
    if (!m.workspaceDir) continue;
    const size = fs.statSync(path.join(resolveWorkspace(m.workspaceDir), "memory.md"), { throwIfNoEntry: false })?.size ?? 0;
    if (size <= MEMORY_FORCE_MIN_BYTES) continue;
    enqueueJob("consolidate_memory", { teammateId: m.id, force: true });
    count++;
  }
  return count;
}
