"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { deskChats, ownerReplied } from "@/lib/desk";
import { sendText } from "@/lib/whatsapp";

/** The owner answers a desk chat on the business's WhatsApp (no Claude involved). */
export async function sendDeskReply(businessId: string, jid: string, text: string): Promise<{ ok: true } | { error: string }> {
  const message = text.trim();
  if (!message) return { error: "Write a message first." };
  if (message.length > 4000) return { error: "That's too long for one WhatsApp message." };
  const business = db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!business) return { error: "Business not found." };
  if (!deskChats(businessId).some((c) => c.jid === jid)) return { error: "This chat isn't on the desk." };
  try {
    await sendText(jid, message);
  } catch (err) {
    return { error: `WhatsApp didn't send it: ${err instanceof Error ? err.message : String(err)}` };
  }
  ownerReplied(businessId, jid, message);
  return { ok: true };
}
