"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { deskChats, ownerReplied } from "@/lib/desk";
import { t } from "@/lib/i18n";
import { sendText } from "@/lib/whatsapp";

/** The owner answers a desk chat on the business's WhatsApp (no Claude involved). `lang` is the UI language the desk is shown in. */
export async function sendDeskReply(businessId: string, jid: string, text: string, lang = "en"): Promise<{ ok: true } | { error: string }> {
  const message = text.trim();
  if (!message) return { error: t(lang, "desk.err.empty") };
  if (message.length > 4000) return { error: t(lang, "desk.err.tooLong") };
  const business = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!business) return { error: t(lang, "common.businessNotFound") };
  if (!deskChats(businessId).some((c) => c.jid === jid)) return { error: t(lang, "desk.err.notOnDesk") };
  try {
    await sendText(jid, message);
  } catch (err) {
    return { error: t(lang, "desk.err.notSent", { reason: err instanceof Error ? err.message : String(err) }) };
  }
  ownerReplied(businessId, jid, message);
  return { ok: true };
}
