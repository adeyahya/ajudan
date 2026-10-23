import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * What the AI team may change by itself, business-wide (Business → Team permissions).
 * Checked when a tool runs, so switching an area takes effect mid-run. An area that's
 * off can be asked for (request_capability kind "edit"); approving switches it on.
 *
 * - contacts: add people to the address book and update them (save_contact). Never delete.
 * - context: edit Context pages directly; off, they suggest and the owner decides.
 * - library: organize media (titles, notes, tags, albums, stars) with organize_media.
 */
export const EDIT_AREAS = ["contacts", "context", "library"] as const;
export type EditArea = (typeof EDIT_AREAS)[number];

export const EDIT_DEFAULTS: Record<EditArea, boolean> = { contacts: true, context: false, library: false };

export function teamEdits(stored: Partial<Record<EditArea, boolean>> | null | undefined): Record<EditArea, boolean> {
  return Object.fromEntries(EDIT_AREAS.map((a) => [a, typeof stored?.[a] === "boolean" ? stored[a] : EDIT_DEFAULTS[a]])) as Record<EditArea, boolean>;
}

export function businessTeamEdits(businessId: string) {
  const row = db.select({ e: schema.businesses.teamEdits }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  return teamEdits(row?.e);
}

export const canTeamEdit = (businessId: string, area: EditArea) => businessTeamEdits(businessId)[area];

export function setTeamEdit(businessId: string, area: EditArea, on: boolean) {
  if (!EDIT_AREAS.includes(area)) throw new Error(`Unknown area ${area}`);
  const next = { ...businessTeamEdits(businessId), [area]: on };
  db.update(schema.businesses).set({ teamEdits: next }).where(eq(schema.businesses.id, businessId)).run();
  return next;
}

export const EDIT_LABELS: Record<EditArea, string> = { contacts: "add and update contacts", context: "edit Context pages directly", library: "organize the media library" };

/** What a teammate is told when it tries something its owner hasn't allowed. */
export function editOffMessage(area: EditArea) {
  return `The owner hasn't let the team ${EDIT_LABELS[area]}. They can switch it on in Business → Team permissions; ask with request_capability (kind "edit", area "${area}") and say why, or mention it in your summary.`;
}
