import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ContactKind } from "@/db/schema";
import { cleanTags } from "@/lib/assets";
import { FOLLOW_UP_FILTERS, inSegment, type SegmentFilter } from "@/lib/contact-filters";
import { CONTACT_KINDS, listContacts } from "@/lib/contacts";
import { dataDir } from "@/lib/paths";

/**
 * Saved segments: named filters over the address book (kind, tags, words, follow-up),
 * shown as views on the Contacts page and readable by teammates (list_segment). Kept in
 * `<folder>/contact-segments.json`, not the database. Matching is in contact-filters.ts.
 */

export type Segment = SegmentFilter & { id: string; businessId: string; name: string; createdAt: string };
export type SegmentInput = { id?: string; name: string; kind?: string | null; tags?: string[] | string; text?: string; followUp?: string };

const file = () => path.join(dataDir(), "contact-segments.json");

function readAll(): Segment[] {
  try {
    const v = JSON.parse(fs.readFileSync(file(), "utf8")) as unknown;
    return Array.isArray(v) ? (v as Segment[]).filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && Array.isArray(s.tags)) : [];
  } catch {
    return [];
  }
}

function writeAll(all: Segment[]) {
  const f = file();
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, f);
}

export function listSegments(businessId: string): Segment[] {
  return readAll()
    .filter((s) => s.businessId === businessId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A segment by id, or by name (any case). */
export function getSegment(businessId: string, idOrName: string) {
  const all = listSegments(businessId);
  const n = idOrName.trim().toLowerCase();
  return all.find((s) => s.id === idOrName) ?? all.find((s) => s.name.toLowerCase() === n);
}

/** Add a segment, or change one (with `id`). */
export function saveSegment(businessId: string, input: SegmentInput): { segment: Segment } | { error: string } {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { error: "A segment needs a name." };
  const all = readAll();
  const cur = input.id ? all.find((s) => s.id === input.id && s.businessId === businessId) : undefined;
  if (input.id && !cur) return { error: "Segment not found." };
  const kind = (Object.keys(CONTACT_KINDS) as ContactKind[]).find((k) => k === input.kind);
  const segment: Segment = {
    id: cur?.id ?? randomUUID(),
    businessId,
    name,
    ...(kind ? { kind } : {}),
    tags: cleanTags(Array.isArray(input.tags) ? input.tags : (input.tags ?? "").split(/[,;]/)),
    text: (input.text ?? "").trim().slice(0, 200),
    followUp: FOLLOW_UP_FILTERS.find((f) => f === input.followUp) ?? "any",
    createdAt: cur?.createdAt ?? new Date().toISOString(),
  };
  writeAll([...all.filter((s) => s.id !== segment.id), segment]);
  return { segment };
}

export function deleteSegment(businessId: string, id: string) {
  const all = readAll();
  const next = all.filter((s) => !(s.id === id && s.businessId === businessId));
  if (next.length !== all.length) writeAll(next);
  return next.length !== all.length;
}

/** The contacts in a segment (Trash left out), by name. */
export function segmentContacts(businessId: string, s: SegmentFilter) {
  const now = new Date();
  return listContacts(businessId).filter((c) => inSegment(c, s, now));
}
