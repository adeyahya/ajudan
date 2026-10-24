import type { BadgeTone } from "@/components/kit";
import type { Contact, ContactKind } from "@/db/schema";
import type { SegmentFilter } from "@/lib/contact-filters";
import type { InteractionKind } from "@/lib/contacts";

/** Shapes and constants shared by the People table, its peek and the server page. */

export type PersonRow = Omit<Contact, "createdAt" | "followUpAt" | "deletedAt"> & { createdAt: string; followUpAt: string | null };
export type View = "all" | "due" | "follow_up" | "new_wa" | ContactKind;
export type SegmentView = SegmentFilter & { id: string; name: string };

export const VIEWS: View[] = ["all", "due", "follow_up", "new_wa", "customer", "supplier", "partner", "team", "other"];
export const KINDS: ContactKind[] = ["customer", "supplier", "partner", "team", "other"];
export const KIND_TONE: Record<ContactKind, BadgeTone> = { customer: "green", supplier: "orange", partner: "blue", team: "purple", other: "gray" };
/** The tag teammates (and older versions) use for "needs a follow-up". */
export const FOLLOW_UP = "follow-up";
export const INTERACTIONS: InteractionKind[] = ["call", "meeting", "note", "message"];

export const toRow = (c: Contact): PersonRow => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the browser's copy
  const { deletedAt, ...rest } = c;
  return { ...rest, createdAt: c.createdAt.toISOString(), followUpAt: c.followUpAt?.toISOString() ?? null };
};
