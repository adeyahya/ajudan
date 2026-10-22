import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contact, ContactKind } from "@/db/schema";
import { cleanTags } from "@/lib/assets";
import { normalizePhone } from "@/lib/humans";

/**
 * The business's address book: customers, suppliers and partners the owner keeps.
 * Teammates look people up with search_contacts, and a name from here works as a
 * WhatsApp target (sending to someone new still needs the owner's approval).
 */

export const CONTACT_KINDS: Record<ContactKind, string> = {
  customer: "Customer",
  supplier: "Supplier",
  partner: "Partner",
  team: "Team",
  other: "Other",
};

export type ContactInput = { name: string; phone?: string; email?: string; company?: string; kind?: string; tags?: string[] | string; notes?: string };

function businessLanguage(businessId: string) {
  return db.select({ l: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.l ?? "en";
}

/** Clean one contact's fields; an error when something can't be saved. */
export function cleanContact(input: ContactInput, language: string): { value: Omit<Contact, "id" | "businessId" | "createdAt"> } | { error: string } {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { error: "A contact needs a name." };
  let phone: string | null = null;
  if (input.phone?.trim()) {
    phone = normalizePhone(input.phone, language);
    if (!phone) return { error: `"${input.phone}" isn't a phone number. Use the country code, e.g. +62 812…` };
  }
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `"${input.email}" isn't an email address.` };
  const kind = (Object.keys(CONTACT_KINDS) as ContactKind[]).find((k) => k === input.kind?.trim().toLowerCase()) ?? "customer";
  const tags = cleanTags(Array.isArray(input.tags) ? input.tags : (input.tags ?? "").split(/[,;]/));
  return { value: { name, phone, email, company: input.company?.trim().slice(0, 120) || null, kind, tags, notes: (input.notes ?? "").trim().slice(0, 4000) } };
}

export function listContacts(businessId: string) {
  return db.select().from(schema.contacts).where(eq(schema.contacts.businessId, businessId)).orderBy(asc(schema.contacts.name)).all();
}

export function saveContact(businessId: string, input: ContactInput & { id?: string }) {
  const c = cleanContact(input, businessLanguage(businessId));
  if ("error" in c) return c;
  if (input.id) {
    const row = db
      .update(schema.contacts)
      .set(c.value)
      .where(and(eq(schema.contacts.id, input.id), eq(schema.contacts.businessId, businessId)))
      .returning()
      .get();
    return row ? { contact: row } : { error: "Contact not found." };
  }
  return { contact: db.insert(schema.contacts).values({ businessId, ...c.value }).returning().get() };
}

export function deleteContact(businessId: string, id: string) {
  db.delete(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.businessId, businessId))).run();
}

// ---- CSV ----

/** CSV rows. The separator (comma, semicolon or tab) is whichever the header row uses most. */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  const header = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((c) => [c, header.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Header names people use, in English and Indonesian/Malay, mapped to our fields. */
const HEADERS: Record<string, keyof ContactInput> = {
  name: "name", nama: "name", "full name": "name", "nama lengkap": "name", contact: "name",
  phone: "phone", "phone number": "phone", mobile: "phone", whatsapp: "phone", wa: "phone", hp: "phone", "no hp": "phone", telepon: "phone", "nomor hp": "phone",
  email: "email", "e-mail": "email", surel: "email",
  company: "company", perusahaan: "company", business: "company", toko: "company", organization: "company",
  kind: "kind", type: "kind", jenis: "kind", tipe: "kind", category: "kind",
  tags: "tags", tag: "tags", label: "tags", labels: "tags",
  notes: "notes", note: "notes", catatan: "notes", keterangan: "notes",
};

/**
 * Import contacts from CSV (or tab/semicolon separated) text with a header row. Rows
 * whose phone or email matches an existing contact update it instead of adding a copy.
 */
export function importContacts(businessId: string, text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, updated: 0, skipped: [] as string[], error: "Need a header row and at least one contact." };
  const cols = rows[0].map((h) => HEADERS[h.trim().toLowerCase()]);
  if (!cols.includes("name")) return { added: 0, updated: 0, skipped: [], error: 'The first row needs a "name" column (also: phone, email, company, kind, tags, notes).' };
  const language = businessLanguage(businessId);
  const existing = listContacts(businessId);
  let added = 0;
  let updated = 0;
  const skipped: string[] = [];
  db.transaction((tx) => {
    for (const [n, r] of rows.slice(1).entries()) {
      const input: ContactInput = { name: "" };
      cols.forEach((k, i) => {
        if (k) (input as Record<string, string>)[k] = r[i] ?? "";
      });
      const c = cleanContact(input, language);
      if ("error" in c) {
        skipped.push(`Row ${n + 2}: ${c.error}`);
        continue;
      }
      const same = existing.find((e) => (c.value.phone && e.phone === c.value.phone) || (c.value.email && e.email === c.value.email));
      if (same) {
        tx.update(schema.contacts)
          .set({ ...c.value, tags: cleanTags([...same.tags, ...c.value.tags]), notes: c.value.notes || same.notes })
          .where(eq(schema.contacts.id, same.id))
          .run();
        updated++;
      } else {
        const row = tx.insert(schema.contacts).values({ businessId, ...c.value }).returning().get();
        existing.push(row);
        added++;
      }
    }
  });
  return { added, updated, skipped: skipped.slice(0, 20) };
}

export function contactsCsv(businessId: string) {
  const q = (v: string | null) => (v && /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : (v ?? ""));
  const lines = listContacts(businessId).map((c) => [c.name, c.phone ? `+${c.phone}` : "", c.email, c.company, c.kind, c.tags.join(", "), c.notes].map(q).join(","));
  return ["name,phone,email,company,kind,tags,notes", ...lines].join("\n") + "\n";
}

// ---- for teammates ----

export function searchAddressBook(businessId: string, query: string, kind?: ContactKind, limit = 20) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listContacts(businessId)
    .filter((c) => !kind || c.kind === kind)
    .filter((c) => {
      const hay = `${c.name} ${c.company ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.tags.join(" ")} ${c.notes}`.toLowerCase();
      return words.every((w) => hay.includes(w.replace(/^#/, "")));
    })
    .slice(0, limit);
}

export function describeContact(c: Contact) {
  const bits = [`${c.name}${c.company ? ` (${c.company})` : ""}`, CONTACT_KINDS[c.kind].toLowerCase()];
  if (c.phone) bits.push(`+${c.phone}`);
  if (c.email) bits.push(c.email);
  if (c.tags.length) bits.push(c.tags.map((t) => `#${t}`).join(" "));
  return `- ${bits.join(" · ")}${c.notes ? `\n  Notes: ${c.notes.replace(/\s+/g, " ")}` : ""}`;
}

/** An address-book entry whose name matches exactly (for WhatsApp targets). */
export function contactByName(businessId: string, name: string) {
  const n = name.trim().toLowerCase();
  return listContacts(businessId).find((c) => c.phone && c.name.toLowerCase() === n);
}
