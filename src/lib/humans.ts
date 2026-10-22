import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Teammate } from "@/db/schema";

/**
 * Human teammates: real people (a videographer, a packer, a reseller coordinator)
 * the AI team works with over WhatsApp. An AI teammate asks with ask_human; the
 * request becomes a task assigned to the human ("waiting_human") and is sent from the
 * business's WhatsApp. Their replies are picked up by the worker (worker/humans.ts)
 * and handed back to whoever asked.
 */

export const HUMAN_ROLE_KEY = "human";
export const HUMAN = "human:";

/** "0812-3456-7890" → "6281234567890" (a leading 0 becomes the country code for the business's language). */
export function normalizePhone(input: string, language = "en") {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) {
    const cc: Record<string, string> = { id: "62", ms: "60" };
    if (!cc[language]) return null;
    digits = cc[language] + digits.slice(1);
  }
  digits = digits.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export const humanJid = (phone: string) => `${phone}@s.whatsapp.net`;

export const isHuman = (t: Pick<Teammate, "kind">) => t.kind === "human";

export function listHumans(businessId: string) {
  return db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.kind, "human"), eq(schema.teammates.status, "active")))
    .all();
}

/** The human's newest open request (what a reply most likely answers). */
export function openRequest(humanId: string) {
  return db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.teammateId, humanId), eq(schema.tasks.status, "waiting_human")))
    .orderBy(desc(schema.tasks.createdAt))
    .get();
}

export function openRequests(humanIds: string[]) {
  if (!humanIds.length) return [];
  return db
    .select()
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.teammateId, humanIds), eq(schema.tasks.status, "waiting_human")))
    .orderBy(asc(schema.tasks.createdAt))
    .all();
}

export function recordHumanMessage(v: typeof schema.humanMessages.$inferInsert) {
  return db.insert(schema.humanMessages).values(v).onConflictDoNothing().returning().get();
}

/** The recent WhatsApp conversation with a human, oldest first, for prompts. */
export function humanThread(humanId: string, limit = 20) {
  const rows = db
    .select()
    .from(schema.humanMessages)
    .where(eq(schema.humanMessages.humanId, humanId))
    .orderBy(desc(schema.humanMessages.sentAt))
    .limit(limit)
    .all()
    .reverse();
  if (!rows.length) return "";
  const names = new Map(
    db
      .select({ id: schema.teammates.id, name: schema.teammates.name })
      .from(schema.teammates)
      .all()
      .map((t) => [t.id, t.name]),
  );
  const human = names.get(humanId) ?? "Them";
  return rows
    .map((m) => {
      const who = m.direction === "in" ? human : m.fromTeammateId ? `${names.get(m.fromTeammateId) ?? "Team"} (AI team)` : "Owner";
      const when = m.sentAt.toISOString().slice(0, 16).replace("T", " ");
      const files = m.attachments.length ? ` [files: ${m.attachments.join(", ")}]` : "";
      return `[${when}] ${who}: ${m.text}${files}`;
    })
    .join("\n");
}

/** First line of a WhatsApp message from an AI teammate: says who it is, and that it's an AI. */
export function senderLine(teammate: Pick<Teammate, "name"> | null, businessName: string, language: string) {
  if (!teammate) return "";
  return language === "id"
    ? `🤖 *${teammate.name}* (asisten AI ${businessName})`
    : `🤖 *${teammate.name}* (${businessName}'s AI assistant)`;
}

export function replyHint(language: string) {
  return language === "id"
    ? "_Balas langsung di chat ini ya. Foto dan video juga kirim di sini._"
    : "_Just reply in this chat. Send photos and videos here too._";
}
