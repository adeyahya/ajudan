"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db, schema } from "@/db";
import { deleteContact, importContacts, saveContact, type ContactInput } from "@/lib/contacts";
import { t } from "@/lib/i18n";
import { ensureManager } from "@/lib/manager";
import { createTask } from "@/lib/tasks";

function ownBusiness(businessId: string) {
  const b = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!b) throw new Error("Business not found");
}

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

export async function importContactsAction(businessId: string, text: string) {
  ownBusiness(businessId);
  const r = importContacts(businessId, text);
  refresh();
  return r;
}
