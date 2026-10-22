"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import type { ContextSection, ReaderMode } from "@/db/schema";
import { saveContact, type ContactInput } from "@/lib/contacts";
import { createPage, decideSuggestion, deletePage, SECTIONS, setReaderMode, updatePage } from "@/lib/context";
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

export async function movePageAction(businessId: string, pageId: string, section: ContextSection) {
  ownBusiness(businessId);
  if (SECTIONS.includes(section)) updatePage(businessId, pageId, { section });
  refresh();
}

export async function markCheckedAction(businessId: string, pageId: string) {
  ownBusiness(businessId);
  updatePage(businessId, pageId, { checked: true });
  refresh();
}

/** A new page in a section; returns its id for the URL. */
export async function createPageAction(businessId: string, section: ContextSection, title: string) {
  ownBusiness(businessId);
  if (!SECTIONS.includes(section)) throw new Error("Unknown section");
  return createPage(businessId, { title, section }).id;
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

/** The contact side-peek: summary (notes), kind, tags. */
export async function saveContactAction(businessId: string, input: ContactInput & { id: string }) {
  ownBusiness(businessId);
  const r = saveContact(businessId, input);
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const };
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
  return { ok: true as const, manager: manager.name };
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
