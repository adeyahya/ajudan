"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizePhone } from "@/lib/humans";
import { t } from "@/lib/i18n";
import { addHuman, setOwnerHuman, type FormState } from "../team/actions";

/**
 * The checklist's "This is me": the owner's own WhatsApp number becomes a person on
 * the team (reusing addHuman's checks) and is marked as the owner, so approval
 * requests reach them on WhatsApp. FormData: name, phone.
 */
export async function setMyNumber(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) return { error: t(String(formData.get("lang") ?? ""), "common.businessNotFound") };
  const phone = normalizePhone(String(formData.get("phone") ?? ""), biz.language);
  if (!phone) return { error: t(biz.language, "manager.err.phone") };
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
    // Stored on the team in the business's working language, like the manager's title.
    fd.set("name", String(formData.get("name") ?? "").trim() || t(biz.language, "manager.owner.defaultName"));
    fd.set("title", t(biz.language, "manager.owner.defaultTitle"));
    fd.set("phone", `+${phone}`);
    fd.set("helps", t(biz.language, "manager.owner.defaultHelps"));
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
  if (!human) return { error: t(biz.language, "manager.err.add") };
  await setOwnerHuman(businessId, human.id);
  return { ok: true };
}
