import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Autonomy } from "@/db/schema";

/**
 * Supervised mode (Business → Team permissions): one switch that makes every change the
 * team makes wait for the owner — outward actions (WhatsApp, browser changes, API
 * writes, GitHub) and team edits (contacts, Context pages, the media library). It only
 * tightens: a draft-only teammate stays draft-only, an area that's off stays off. Switched
 * off, each teammate's freedom and the Team permissions apply again, unchanged.
 * Checked when a tool runs, so it takes effect mid-run.
 */

export function isSupervised(businessId: string) {
  const row = db.select({ s: schema.businesses.supervised }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  return row?.s ?? false;
}

export function setSupervised(businessId: string, on: boolean) {
  db.update(schema.businesses).set({ supervised: on }).where(eq(schema.businesses.id, businessId)).run();
}

/** A teammate's freedom for outward actions, with supervision applied. */
export function effectiveAutonomy(autonomy: Autonomy, supervised: boolean): Autonomy {
  return supervised && autonomy === "auto" ? "ask" : autonomy;
}

/** What happens to a team edit the area allows: done directly, or asked for first while supervised. */
export function editGate(areaOn: boolean, supervised: boolean): "allow" | "ask" {
  return areaOn && supervised ? "ask" : "allow";
}
