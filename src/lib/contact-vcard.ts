import type { Contact } from "@/db/schema";
import { businessLanguage, importRows, listContacts, type ContactInput, type ImportResult } from "@/lib/contacts";
import { normalizePhone } from "@/lib/humans";

/**
 * vCard (.vcf) import and export for the address book, no dependency. Reads versions 2.1,
 * 3.0 and 4.0 as phones export them: FN, N, TEL, EMAIL, ORG, NOTE, CATEGORIES, folded
 * lines, backslash escapes and QUOTED-PRINTABLE values. Extra phones and emails become
 * custom fields. Export writes 3.0, with the kind and custom fields as X-AJUDAN-*
 * properties so a round trip keeps them.
 */

type Prop = { name: string; params: Record<string, string[]>; value: string };

/** "a\,b\nc" → "a,b\nc". */
const unescape = (v: string) => v.replace(/\\([\\,;nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Split on a separator that isn't backslash-escaped, then unescape each part. */
function splitValue(v: string, sep: string) {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      cur += v[i] + v[i + 1];
      i++;
    } else if (v[i] === sep) {
      parts.push(cur);
      cur = "";
    } else cur += v[i];
  }
  parts.push(cur);
  return parts.map(unescape);
}

function decodeQuotedPrintable(v: string) {
  const bytes: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(v.slice(i + 1, i + 3))) {
      bytes.push(parseInt(v.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(v[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Unfold the text into logical lines (RFC 6350 folding, and 2.1 quoted-printable soft breaks). */
function logicalLines(text: string) {
  const raw = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const out: string[] = [];
  for (const line of raw) {
    const prev = out.length - 1;
    if ((line.startsWith(" ") || line.startsWith("\t")) && prev >= 0) out[prev] += line.slice(1);
    else if (prev >= 0 && /ENCODING=QUOTED-PRINTABLE/i.test(out[prev].split(":")[0]) && out[prev].endsWith("=")) out[prev] = out[prev].slice(0, -1) + line;
    else out.push(line);
  }
  return out;
}

function parseLine(line: string): Prop | null {
  // The value starts at the first ":" outside a quoted parameter value.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [head, ...rawParams] = line.slice(0, colon).split(";");
  const name = head.replace(/^.*\./, "").toUpperCase(); // drop "item1." groups
  const params: Record<string, string[]> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    // vCard 2.1 writes bare types: TEL;CELL;PREF:…
    const key = (eq < 0 ? "TYPE" : p.slice(0, eq)).toUpperCase();
    const vals = (eq < 0 ? p : p.slice(eq + 1)).replace(/"/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    params[key] = [...(params[key] ?? []), ...vals];
  }
  let value = line.slice(colon + 1);
  if (params.ENCODING?.some((e) => /quoted-printable/i.test(e))) value = decodeQuotedPrintable(value);
  return { name, params, value };
}

const types = (p: Prop) => (p.params.TYPE ?? []).map((t) => t.toLowerCase());

/** Every card in the text, as contact inputs (cards without any name are dropped). */
export function parseVcards(text: string): ContactInput[] {
  const cards: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const line of logicalLines(text)) {
    if (/^BEGIN:VCARD$/i.test(line.trim())) cur = [];
    else if (/^END:VCARD$/i.test(line.trim())) {
      if (cur) cards.push(cur);
      cur = null;
    } else if (cur && line.trim()) {
      const p = parseLine(line);
      if (p) cur.push(p);
    }
  }
  return cards.map(cardToInput).filter((c): c is ContactInput => !!c);
}

function cardToInput(props: Prop[]): ContactInput | null {
  const get = (n: string) => props.filter((p) => p.name === n);
  const fn = get("FN")[0] ? unescape(get("FN")[0].value).trim() : "";
  let name = fn;
  if (!name && get("N")[0]) {
    const [family = "", given = "", middle = "", prefix = "", suffix = ""] = splitValue(get("N")[0].value, ";");
    name = [prefix, given, middle, family, suffix].map((x) => x.trim()).filter(Boolean).join(" ");
  }
  const org = get("ORG")[0] ? splitValue(get("ORG")[0].value, ";")[0].trim() : "";
  if (!name) name = org;
  if (!name) return null;

  // The preferred or mobile number first.
  const rank = (p: Prop) => (types(p).includes("pref") || p.params.PREF ? 0 : types(p).includes("cell") ? 1 : 2);
  const tels = get("TEL")
    .map((p) => ({ p, v: unescape(p.value).replace(/^tel:/i, "").trim() }))
    .filter((x) => x.v)
    .sort((a, b) => rank(a.p) - rank(b.p));
  const emails = get("EMAIL")
    .map((p) => unescape(p.value).trim())
    .filter(Boolean);
  const fields: Record<string, string> = {};
  tels.slice(1).forEach((x, i) => (fields[i ? `Phone ${i + 2}` : "Phone 2"] = x.v));
  emails.slice(1).forEach((x, i) => (fields[i ? `Email ${i + 2}` : "Email 2"] = x));
  const title = get("TITLE")[0];
  if (title) fields["Title"] = unescape(title.value).trim();
  const bday = get("BDAY")[0];
  if (bday) fields["Birthday"] = unescape(bday.value).trim();
  for (const p of get("X-AJUDAN-FIELD")) {
    const key = p.params["X-NAME"]?.join(",");
    if (key) fields[key] = unescape(p.value);
  }
  const tags = get("CATEGORIES").flatMap((p) => splitValue(p.value, ","));
  return {
    name,
    phone: tels[0]?.v,
    email: emails[0],
    company: org || undefined,
    kind: get("X-AJUDAN-KIND")[0]?.value.trim() || undefined,
    tags,
    notes: get("NOTE")
      .map((p) => unescape(p.value).trim())
      .filter(Boolean)
      .join("\n"),
    fields,
  };
}

/** Whether pasted or uploaded text is vCard rather than CSV. */
export const looksLikeVcard = (text: string) => /^\s*(?:﻿)?BEGIN:VCARD/i.test(text);

/** Import every card; people already there (same phone or email) are updated. */
export function importVcards(businessId: string, text: string): ImportResult {
  const cards = parseVcards(text);
  if (!cards.length) return { added: 0, updated: 0, skipped: [], error: "No contacts found in that vCard." };
  // A number we can't read (a local one without country code) shouldn't lose the person: keep it as a field.
  const language = businessLanguage(businessId);
  return importRows(
    businessId,
    cards.map((input, i) => {
      if (input.phone && !normalizePhone(input.phone, language)) input = { ...input, phone: undefined, fields: { Phone: input.phone, ...input.fields } };
      return { label: `Card ${i + 1} (${input.name})`, input };
    }),
  );
}

const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const escapeParam = (v: string) => `"${v.replace(/["\r\n;]/g, "")}"`;

/** Fold at 75 characters (continuation lines start with a space). */
function fold(line: string) {
  const chars = [...line];
  if (chars.length <= 75) return line;
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += i === 0 ? 75 : 74) parts.push(chars.slice(i, i + (i === 0 ? 75 : 74)).join(""));
  return parts.join("\r\n ");
}

export function contactToVcard(c: Pick<Contact, "name" | "phone" | "email" | "company" | "kind" | "tags" | "notes" | "fields">) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escape(c.name)}`, `N:;${escape(c.name)};;;`];
  if (c.phone) lines.push(`TEL;TYPE=CELL:+${c.phone}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${escape(c.email)}`);
  if (c.company) lines.push(`ORG:${escape(c.company)}`);
  if (c.notes) lines.push(`NOTE:${escape(c.notes)}`);
  if (c.tags.length) lines.push(`CATEGORIES:${c.tags.map(escape).join(",")}`);
  lines.push(`X-AJUDAN-KIND:${c.kind}`);
  for (const [k, v] of Object.entries(c.fields ?? {})) lines.push(`X-AJUDAN-FIELD;X-NAME=${escapeParam(k)}:${escape(v)}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The whole address book (without Trash) as one .vcf. */
export function contactsVcf(businessId: string) {
  return listContacts(businessId).map(contactToVcard).join("");
}
