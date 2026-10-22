"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizePhone } from "@/lib/humans";
import { addHuman, setOwnerHuman, type FormState } from "../team/actions";

/**
 * The checklist's "This is me": the owner's own WhatsApp number becomes a person on
 * the team (reusing addHuman's checks) and is marked as the owner, so approval
 * requests reach them on WhatsApp. FormData: name, phone.
 */
export async function setMyNumber(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) return { error: "Business not found" };
  const phone = normalizePhone(String(formData.get("phone") ?? ""), biz.language);
  if (!phone) return { error: "Enter your WhatsApp number with the country code, e.g. +62 812 3456 7890" };
  const existing = db
    .select({ id: schema.teammates.id })
    .from(schema.teammates)
    .where(
      and(
        eq(schema.teammates.businessId, businessId),
        eq(schema.teammates.kind, "human"),
        eq(schema.teammates.phone, phone),
        eq(schema.teammates.status, "active"),
      ),
    )
    .get();
  if (!existing) {
    const fd = new FormData();
    fd.set("name", String(formData.get("name") ?? "").trim() || "Owner");
    fd.set("title", "Owner");
    fd.set("phone", `+${phone}`);
    fd.set("helps", "Decisions and approvals\nAnswers about the business");
    const added = await addHuman(businessId, {}, fd);
    if (added.error) return added;
  }
  const human =
    existing ??
    db
      .select({ id: schema.teammates.id })
      .from(schema.teammates)
      .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.phone, phone), eq(schema.teammates.status, "active")))
      .get();
  if (!human) return { error: "Couldn't add you to the team" };
  await setOwnerHuman(businessId, human.id);
  return { ok: true };
}
