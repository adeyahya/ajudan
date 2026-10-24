import type { Contact, ContactKind } from "@/db/schema";

/**
 * Pure contact filters shared by the server (segments, list_segment) and the Contacts
 * page in the browser: no database or file access here.
 */

export type FollowUpFilter = "any" | "set" | "due" | "none";
export const FOLLOW_UP_FILTERS: FollowUpFilter[] = ["any", "set", "due", "none"];

export type SegmentFilter = { kind?: ContactKind; tags: string[]; text: string; followUp: FollowUpFilter };

/** The end of `now`'s day in local time (the default "due by" for follow-ups). */
export function endOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

type Matchable = Pick<Contact, "name" | "company" | "phone" | "email" | "kind" | "tags" | "notes" | "fields"> & { followUpAt: Date | string | null };

/** Whether a follow-up date is due (today or overdue). */
export const isDue = (at: Date | string | null, now = new Date()) => !!at && new Date(at) <= endOfToday(now);

/** Whether a contact matches a segment's filters (rows or the page's serialized rows). */
export function inSegment(c: Matchable, s: SegmentFilter, now = new Date()) {
  if (s.kind && c.kind !== s.kind) return false;
  if (s.tags.some((t) => !c.tags.includes(t))) return false;
  if (s.followUp === "set" && !c.followUpAt) return false;
  if (s.followUp === "none" && c.followUpAt) return false;
  if (s.followUp === "due" && !isDue(c.followUpAt, now)) return false;
  const words = s.text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${c.name} ${c.company ?? ""} ${c.phone ?? ""} ${c.email ?? ""} ${c.tags.join(" ")} ${c.notes} ${Object.entries(c.fields ?? {}).flat().join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w.replace(/^#/, "")));
}
