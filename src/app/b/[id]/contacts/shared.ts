import type { BadgeTone } from "@/components/kit";
import type { Contact, ContactKind } from "@/db/schema";

/** Shapes and constants shared by the People table, its peek and the server page. */

export type PersonRow = Omit<Contact, "createdAt"> & { createdAt: string };
export type HistoryItem = { kind: "task" | "whatsapp"; id: string; title: string; who: string; status: string; at: string; href: string | null };
export type View = "all" | "follow_up" | "new_wa" | ContactKind;

export const VIEWS: View[] = ["all", "follow_up", "new_wa", "customer", "supplier", "partner", "team", "other"];
export const KINDS: ContactKind[] = ["customer", "supplier", "partner", "team", "other"];
export const KIND_TONE: Record<ContactKind, BadgeTone> = { customer: "green", supplier: "orange", partner: "blue", team: "purple", other: "gray" };
export const FOLLOW_UP = "follow-up";
