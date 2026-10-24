import { and, asc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contact, ContactKind } from "@/db/schema";
import { cleanTags } from "@/lib/assets";
import { endOfToday } from "@/lib/contact-filters";
import { normalizePhone } from "@/lib/humans";
import { recordHistory } from "@/lib/object-history";
import { matchIds } from "@/lib/search";
import { softDelete } from "@/lib/trash";

/**
 * The business's address book: customers, suppliers and partners the owner keeps.
 * Teammates look people up with search_contacts, and a name from here works as a
 * WhatsApp target (sending to someone new still needs the owner's approval).
 * Owner edits, follow-ups and logged interactions go into object_history; the
 * timeline (src/lib/contact-timeline.ts) reads them back.
 */

export const CONTACT_KINDS: Record<ContactKind, string> = {
  customer: "Customer",
  supplier: "Supplier",
  partner: "Partner",
  team: "Team",
  other: "Other",
};

export type ContactInput = {
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  kind?: string;
  tags?: string[] | string;
  notes?: string;
  /** The owner's own fields; left as they are when not given. */
  fields?: Record<string, string>;
};

const MAX_FIELDS = 30;

/** Custom fields: trimmed keys (≤ 40 chars) and values (≤ 500), empty ones dropped, at most 30. */
export function cleanFields(fields: Record<string, string> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    const key = String(k).replace(/\s+/g, " ").trim().slice(0, 40);
    const value = String(v ?? "").trim().slice(0, 500);
    if (!key || !value || key in out) continue;
    out[key] = value;
    if (Object.keys(out).length >= MAX_FIELDS) break;
  }
  return out;
}

export function businessLanguage(businessId: string) {
  return db.select({ l: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.l ?? "en";
}

/** Clean one contact's fields; an error when something can't be saved. */
export function cleanContact(
  input: ContactInput,
  language: string,
): { value: Pick<Contact, "name" | "phone" | "email" | "company" | "kind" | "tags" | "notes"> } | { error: string } {
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

/** The address book, without contacts in Trash. */
export function listContacts(businessId: string) {
  return db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.businessId, businessId), isNull(schema.contacts.deletedAt)))
    .orderBy(asc(schema.contacts.name))
    .all();
}

/** One live contact of this business, or undefined. */
export function getContact(businessId: string, id: string) {
  return db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.businessId, businessId), isNull(schema.contacts.deletedAt)))
    .get();
}

/** The owner's edit or new contact (the Contacts page). Recorded in object_history with who made it. */
export function saveContact(businessId: string, input: ContactInput & { id?: string }, by = "owner") {
  const c = cleanContact(input, businessLanguage(businessId));
  if ("error" in c) return c;
  const fields = input.fields !== undefined ? { fields: cleanFields(input.fields) } : {};
  if (input.id) {
    const row = db
      .update(schema.contacts)
      .set({ ...c.value, ...fields, updatedBy: by })
      .where(and(eq(schema.contacts.id, input.id), eq(schema.contacts.businessId, businessId), isNull(schema.contacts.deletedAt)))
      .returning()
      .get();
    if (!row) return { error: "Contact not found." };
    recordHistory({ businessId, type: "contact", id: row.id, snapshot: row, action: "update", by });
    return { contact: row };
  }
  const row = db.insert(schema.contacts).values({ businessId, ...c.value, ...fields, createdBy: by, updatedBy: by }).returning().get();
  recordHistory({ businessId, type: "contact", id: row.id, snapshot: row, action: "create", by });
  return { contact: row };
}

/** Move a contact to Trash (src/lib/trash.ts); purging it from there deletes it for good. */
export function deleteContact(businessId: string, id: string, by = "owner") {
  softDelete(businessId, "contact", id, by);
}

// ---- follow-ups and interactions ----

export type InteractionKind = "call" | "meeting" | "note" | "message";
export const INTERACTION_KINDS: InteractionKind[] = ["call", "meeting", "note", "message"];

export { endOfToday };

/** Contacts to get back to: overdue and due by `until` (default the end of today), soonest first. */
export function dueFollowUps(businessId: string, until?: Date): Contact[] {
  const t = schema.contacts;
  return db
    .select()
    .from(t)
    .where(and(eq(t.businessId, businessId), isNull(t.deletedAt), isNotNull(t.followUpAt), lte(t.followUpAt, until ?? endOfToday())))
    .orderBy(asc(t.followUpAt), asc(t.name))
    .all();
}

/**
 * Set (or, with `at` null, clear) when to get back to someone and what for. Recorded in
 * object_history as the row plus a `followUp` entry, which the timeline shows.
 */
export function setFollowUp(businessId: string, id: string, at: Date | null, note: string, by = "owner") {
  if (at && Number.isNaN(at.getTime())) return { error: "That isn't a date." };
  const row = db
    .update(schema.contacts)
    .set({ followUpAt: at, followUpNote: at ? note.trim().slice(0, 500) : "", updatedBy: by })
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.businessId, businessId), isNull(schema.contacts.deletedAt)))
    .returning()
    .get();
  if (!row) return { error: "Contact not found." };
  recordHistory({
    businessId,
    type: "contact",
    id,
    snapshot: { ...row, followUp: { action: at ? "set" : "clear", at: at?.toISOString() ?? null, note: row.followUpNote } },
    action: "update",
    by,
  });
  return { contact: row };
}

/** The follow-up happened: clear it, and keep what it was for in the timeline. */
export function completeFollowUp(businessId: string, id: string, by = "owner") {
  const cur = getContact(businessId, id);
  if (!cur) return { error: "Contact not found." };
  if (!cur.followUpAt) return { error: "No follow-up is set for this contact." };
  const row = db.update(schema.contacts).set({ followUpAt: null, followUpNote: "", updatedBy: by }).where(eq(schema.contacts.id, id)).returning().get()!;
  recordHistory({
    businessId,
    type: "contact",
    id,
    snapshot: { ...row, followUp: { action: "done", at: cur.followUpAt.toISOString(), note: cur.followUpNote } },
    action: "update",
    by,
  });
  return { contact: row };
}

/** A call, meeting, note or message with someone, kept in their timeline (object_history; the row doesn't change). */
export function logInteraction(businessId: string, id: string, kind: InteractionKind, text: string, by = "owner") {
  const body = text.trim().slice(0, 4000);
  if (!body) return { error: "Say what happened." };
  if (!INTERACTION_KINDS.includes(kind)) return { error: `Kind must be one of ${INTERACTION_KINDS.join(", ")}.` };
  const cur = getContact(businessId, id);
  if (!cur) return { error: "Contact not found." };
  const entry = recordHistory({ businessId, type: "contact", id, snapshot: { interaction: { kind, text: body } }, action: "update", by });
  return { entry, contact: cur };
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

type StdField = Exclude<keyof ContactInput, "fields">;

/** Header names people use, in English and Indonesian/Malay, mapped to our fields. */
const HEADERS: Record<string, StdField> = {
  name: "name", nama: "name", "full name": "name", "nama lengkap": "name", contact: "name",
  phone: "phone", "phone number": "phone", mobile: "phone", whatsapp: "phone", wa: "phone", hp: "phone", "no hp": "phone", telepon: "phone", "nomor hp": "phone", "phone 1 - value": "phone",
  email: "email", "e-mail": "email", surel: "email", "e-mail 1 - value": "email",
  company: "company", perusahaan: "company", business: "company", toko: "company", organization: "company", "organization name": "company", "organization 1 - name": "company",
  kind: "kind", type: "kind", jenis: "kind", tipe: "kind", category: "kind",
  tags: "tags", tag: "tags", label: "tags", labels: "tags",
  notes: "notes", note: "notes", catatan: "notes", keterangan: "notes",
};

/** A column we don't know becomes a custom field, unless it's an export's bookkeeping ("Phone 1 - Type"). */
const customColumn = (header: string) => {
  const h = header.trim();
  return h && h.length <= 40 && !/ - (type|label)$/i.test(h) ? h : null;
};

/** Rows to import, each with a label for the "skipped" list ("Row 3", "Card 2"). */
export type ImportRow = { label: string; input: ContactInput };
export type ImportResult = { added: number; updated: number; skipped: string[]; error?: string };

/**
 * Add contacts; someone whose phone or email matches an existing contact updates that one
 * instead (tags added, fields filled in, notes kept when the new row has none).
 */
export function importRows(businessId: string, rows: ImportRow[], by = "owner"): ImportResult {
  const language = businessLanguage(businessId);
  const existing = listContacts(businessId);
  let added = 0;
  let updated = 0;
  const skipped: string[] = [];
  db.transaction((tx) => {
    for (const { label, input } of rows) {
      const c = cleanContact(input, language);
      if ("error" in c) {
        skipped.push(`${label}: ${c.error}`);
        continue;
      }
      const fields = cleanFields(input.fields);
      const same = existing.find((e) => (c.value.phone && e.phone === c.value.phone) || (c.value.email && e.email === c.value.email));
      if (same) {
        const row = tx
          .update(schema.contacts)
          .set({
            ...c.value,
            tags: cleanTags([...same.tags, ...c.value.tags]),
            notes: c.value.notes || same.notes,
            fields: cleanFields({ ...same.fields, ...fields }),
            updatedBy: by,
          })
          .where(eq(schema.contacts.id, same.id))
          .returning()
          .get();
        recordHistory({ businessId, type: "contact", id: row.id, snapshot: row, action: "update", by });
        Object.assign(same, row);
        updated++;
      } else {
        const row = tx.insert(schema.contacts).values({ businessId, ...c.value, fields, createdBy: by, updatedBy: by }).returning().get();
        recordHistory({ businessId, type: "contact", id: row.id, snapshot: row, action: "create", by });
        existing.push(row);
        added++;
      }
    }
  });
  return { added, updated, skipped: skipped.slice(0, 20) };
}

/**
 * Import contacts from CSV (or tab/semicolon separated) text with a header row. Columns we
 * don't recognize become custom fields. Rows whose phone or email matches an existing
 * contact update it instead of adding a copy.
 */
export function importContacts(businessId: string, text: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, updated: 0, skipped: [], error: "Need a header row and at least one contact." };
  const cols = rows[0].map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  const custom = rows[0].map((h, i) => (cols[i] ? null : customColumn(h)));
  if (!cols.includes("name")) return { added: 0, updated: 0, skipped: [], error: 'The first row needs a "name" column (also: phone, email, company, kind, tags, notes).' };
  return importRows(
    businessId,
    rows.slice(1).map((r, n) => {
      const input: ContactInput = { name: "", fields: {} };
      cols.forEach((k, i) => {
        if (k) (input as unknown as Record<StdField, string>)[k] = r[i] ?? "";
        else if (custom[i] && r[i]?.trim()) input.fields![custom[i]!] = r[i];
      });
      return { label: `Row ${n + 2}`, input };
    }),
  );
}

/** The address book as CSV; custom fields get a column each after the standard ones. */
export function contactsCsv(businessId: string) {
  const q = (v: string | null) => (v && /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : (v ?? ""));
  const contacts = listContacts(businessId);
  const std = new Set(["name", "phone", "email", "company", "kind", "tags", "notes"]);
  const extra = [...new Set(contacts.flatMap((c) => Object.keys(c.fields ?? {})))].filter((k) => !std.has(k.toLowerCase()));
  const lines = contacts.map((c) =>
    [c.name, c.phone ? `+${c.phone}` : "", c.email, c.company, c.kind, c.tags.join(", "), c.notes, ...extra.map((k) => c.fields?.[k] ?? "")].map(q).join(","),
  );
  return [["name", "phone", "email", "company", "kind", "tags", "notes", ...extra].map(q).join(","), ...lines].join("\n") + "\n";
}

// ---- for teammates ----

export function searchAddressBook(businessId: string, query: string, kind?: ContactKind, limit = 20) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // The index narrows it down (src/lib/search.ts); the filter below still checks every word.
  const ids = matchIds("contacts", businessId, words.map((w) => w.replace(/^#/, "")), { all: true, limit: 2000 });
  const candidates = ids
    ? ids.length
      ? db
          .select()
          .from(schema.contacts)
          .where(and(eq(schema.contacts.businessId, businessId), inArray(schema.contacts.id, ids), isNull(schema.contacts.deletedAt)))
          .orderBy(asc(schema.contacts.name))
          .all()
      : []
    : listContacts(businessId);
  return candidates
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
  const extra: string[] = [];
  const fields = Object.entries(c.fields ?? {});
  if (fields.length) extra.push(`Fields: ${fields.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  if (c.followUpAt) extra.push(`Follow up: ${c.followUpAt.toISOString().slice(0, 10)}${c.followUpNote ? ` (${c.followUpNote})` : ""}`);
  if (c.notes) extra.push(`Notes: ${c.notes.replace(/\s+/g, " ")}`);
  return `- ${bits.join(" · ")}${extra.map((x) => `\n  ${x}`).join("")}`;
}

/**
 * A teammate's save_contact: update the person if they're already in the address book
 * (by id, then phone, then exact name), changing only the fields given (tags are added,
 * notes appended), or add them. Returns whether it was new.
 */
export function upsertContact(businessId: string, input: Partial<ContactInput> & { id?: string }, by: string) {
  const language = businessLanguage(businessId);
  const all = listContacts(businessId);
  const phone = input.phone?.trim() ? normalizePhone(input.phone, language) : null;
  if (input.phone?.trim() && !phone) return { error: `"${input.phone}" isn't a phone number. Use the country code, e.g. +62 812…` };
  const cur =
    (input.id && all.find((c) => c.id === input.id)) ||
    (phone && all.find((c) => c.phone === phone)) ||
    (input.name?.trim() && all.find((c) => c.name.toLowerCase() === input.name!.trim().toLowerCase())) ||
    undefined;
  if (input.id && !cur) return { error: `No contact with id ${input.id}.` };
  const tags = Array.isArray(input.tags) ? input.tags : (input.tags ?? "").split(/[,;]/);
  const notes = input.notes?.trim();
  const merged: ContactInput = {
    name: input.name?.trim() || cur?.name || "",
    phone: input.phone?.trim() ? input.phone : (cur?.phone ? `+${cur.phone}` : undefined),
    email: input.email?.trim() || cur?.email || undefined,
    company: input.company?.trim() || cur?.company || undefined,
    kind: input.kind || cur?.kind,
    tags: [...(cur?.tags ?? []), ...tags],
    notes: cur?.notes && notes && !cur.notes.includes(notes) ? `${cur.notes}\n${notes}` : notes || cur?.notes,
  };
  const c = cleanContact(merged, language);
  if ("error" in c) return c;
  if (cur) {
    const row = db.update(schema.contacts).set({ ...c.value, updatedBy: by }).where(eq(schema.contacts.id, cur.id)).returning().get();
    return { contact: row, created: false };
  }
  return { contact: db.insert(schema.contacts).values({ businessId, ...c.value, createdBy: by, updatedBy: by }).returning().get(), created: true };
}

/** An address-book entry whose name matches exactly (for WhatsApp targets). */
export function contactByName(businessId: string, name: string) {
  const n = name.trim().toLowerCase();
  return listContacts(businessId).find((c) => c.phone && c.name.toLowerCase() === n);
}
