"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { findDuplicateContacts, mergeContacts } from "@/lib/contact-duplicates";
import { deleteSegment, saveSegment, type SegmentInput } from "@/lib/contact-segments";
import { importVcards, looksLikeVcard } from "@/lib/contact-vcard";
import { completeFollowUp, deleteContact, importContacts, logInteraction, saveContact, setFollowUp, type ContactInput, type InteractionKind } from "@/lib/contacts";
import { t } from "@/lib/i18n";
import { ensureManager } from "@/lib/manager";
import { createTask } from "@/lib/tasks";
import { toRow, type PersonRow } from "./shared";

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

export async function saveContactAction(businessId: string, input: ContactInput & { id?: string }) {
  ownBusiness(businessId);
  const r = saveContact(businessId, input, "owner");
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

/** CSV or vCard (detected from the text). */
export async function importContactsAction(businessId: string, text: string) {
  ownBusiness(businessId);
  const r = looksLikeVcard(text) ? importVcards(businessId, text) : importContacts(businessId, text);
  refresh();
  return r;
}

/** Set the follow-up to a day ("YYYY-MM-DD", 09:00 local) with a note, or clear it with null. */
export async function setFollowUpAction(businessId: string, contactId: string, day: string | null, note: string) {
  ownBusiness(businessId);
  let at: Date | null = null;
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "That isn't a date." };
    at = new Date(`${day}T09:00:00`);
  }
  const r = setFollowUp(businessId, contactId, at, note, "owner");
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const };
}

export async function completeFollowUpAction(businessId: string, contactId: string) {
  ownBusiness(businessId);
  const r = completeFollowUp(businessId, contactId, "owner");
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const };
}

export async function logInteractionAction(businessId: string, contactId: string, kind: InteractionKind, text: string) {
  ownBusiness(businessId);
  const r = logInteraction(businessId, contactId, kind, text, "owner");
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const };
}

export type DuplicateGroupView = { keep: PersonRow; others: PersonRow[]; reasons: string[] };

export async function findDuplicatesAction(businessId: string): Promise<DuplicateGroupView[]> {
  ownBusiness(businessId);
  return findDuplicateContacts(businessId).map((g) => ({ keep: toRow(g.keep), others: g.others.map(toRow), reasons: g.reasons }));
}

export async function mergeContactsAction(businessId: string, keepId: string, otherIds: string[]) {
  ownBusiness(businessId);
  const r = mergeContacts(businessId, keepId, otherIds, "owner");
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const, merged: r.merged };
}

export async function saveSegmentAction(businessId: string, input: SegmentInput) {
  ownBusiness(businessId);
  const r = saveSegment(businessId, input);
  refresh();
  return "error" in r ? { error: r.error } : { ok: true as const, id: r.segment.id };
}

export async function deleteSegmentAction(businessId: string, id: string) {
  ownBusiness(businessId);
  deleteSegment(businessId, id);
  refresh();
}
