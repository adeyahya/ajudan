import { and, eq, gte, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/events";
import { listHumans } from "@/lib/humans";
import { activeWatchFor, activeWatches, watchState } from "@/lib/watches";
import { isRealMessage, listMessages, messageText, type WaMessage } from "@/lib/whatsapp";

/**
 * The Customer Desk: the owner answers WhatsApp themselves, at no Claude cost, e.g.
 * while the team rests (src/lib/rest.ts). It shows the conversations the team keeps
 * (wa_watches) and the chats the business allows teammates in (businesses.whatsappChats).
 * Messages go out through wacli like the team's; the team then treats them as answered.
 */

export type DeskChat = {
  jid: string;
  name: string;
  /** Who on the team keeps this conversation, if anyone. */
  teammate?: string;
  /** The team's view of it: waiting for them, they replied, or no reply in time. */
  watch?: "waiting" | "replied" | "no reply";
};

export type DeskMessage = { id: string; fromMe: boolean; sender: string; text: string; media?: string; at: string };

export type DeskChatSummary = DeskChat & { last?: DeskMessage; needsReply: boolean };

/** Written by worker/replies.ts on the reply tasks it hands to teammates. */
const REPLY_TASK = "system:reply";
/** Each answer on the desk earns this much XP for the owner's shift score. */
export const XP_PER_REPLY = 10;

export function deskChats(businessId: string): DeskChat[] {
  const humans = new Set(listHumans(businessId).map((h) => `${h.phone}@s.whatsapp.net`));
  const names = new Map(db.select({ id: schema.teammates.id, name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all().map((t) => [t.id, t.name]));
  const chats = new Map<string, DeskChat>();
  for (const w of activeWatches(businessId)) {
    // Teammates who are people have their own inbox; one entry per chat (newest watch first).
    if (humans.has(w.jid) || chats.has(w.jid)) continue;
    chats.set(w.jid, { jid: w.jid, name: w.name, teammate: names.get(w.teammateId), watch: watchState(w) });
  }
  const allowed = db.select({ c: schema.businesses.whatsappChats }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.c ?? [];
  for (const c of allowed) if (!chats.has(c.jid)) chats.set(c.jid, { jid: c.jid, name: c.name });
  return [...chats.values()];
}

export function toDeskMessage(m: WaMessage): DeskMessage {
  return {
    id: m.MsgID,
    fromMe: m.FromMe,
    sender: m.FromMe ? "You" : m.SenderName || m.SenderJID.split("@")[0],
    text: messageText(m),
    media: m.MediaType ? m.Filename || m.MediaType : undefined,
    at: m.Timestamp,
  };
}

/** Recent messages in a chat, oldest first. */
export async function deskMessages(jid: string, limit = 40) {
  const msgs = await listMessages(jid, { limit });
  return msgs
    .filter(isRealMessage)
    .sort((a, b) => a.Timestamp.localeCompare(b.Timestamp))
    .map(toDeskMessage);
}

/** Every chat with its newest message; the ones whose last word is the customer's come first. */
export async function deskSummaries(businessId: string): Promise<DeskChatSummary[]> {
  const rows = await Promise.all(
    deskChats(businessId).map(async (c) => {
      const last = (await deskMessages(c.jid, 5).catch(() => [])).at(-1);
      return { ...c, last, needsReply: !!last && !last.fromMe };
    }),
  );
  return rows.sort((a, b) => Number(b.needsReply) - Number(a.needsReply) || (b.last?.at ?? "").localeCompare(a.last?.at ?? ""));
}

/**
 * After the owner answered a chat on the desk: what the customer wrote up to now counts
 * as handled, and a reply the team hasn't started yet is dropped so they don't answer twice.
 */
export function ownerReplied(businessId: string, jid: string, text: string) {
  const now = new Date();
  const w = activeWatchFor(businessId, jid);
  if (w) {
    db.update(schema.waWatches).set({ status: "replied", seenUntil: now, lastSentAt: now }).where(eq(schema.waWatches.id, w.id)).run();
  }
  const dropped = db
    .update(schema.tasks)
    .set({ status: "cancelled", result: "The owner answered this chat on the Customer Desk.", finishedAt: now })
    .where(
      and(
        eq(schema.tasks.businessId, businessId),
        eq(schema.tasks.status, "queued"),
        eq(schema.tasks.createdBy, REPLY_TASK),
        like(schema.tasks.instructions, `%"${jid}"%`),
      ),
    )
    .returning({ id: schema.tasks.id })
    .all();
  const name = w?.name ?? deskChats(businessId).find((c) => c.jid === jid)?.name ?? jid.split("@")[0];
  logEvent({
    businessId,
    type: "owner_replied",
    message: `You answered ${name} on the Customer Desk: "${text.replace(/\s+/g, " ").slice(0, 80)}"`,
    data: { jid, droppedTasks: dropped.map((d) => d.id), xp: XP_PER_REPLY },
  });
}

/** The owner's desk score: answers today and all time (XP comes from those). */
export function deskScore(businessId: string) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const all = db
    .select({ at: schema.activityEvents.createdAt })
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.businessId, businessId), eq(schema.activityEvents.type, "owner_replied")))
    .all();
  const today = db
    .select({ id: schema.activityEvents.id })
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.businessId, businessId), eq(schema.activityEvents.type, "owner_replied"), gte(schema.activityEvents.createdAt, midnight)))
    .all().length;
  const xp = all.length * XP_PER_REPLY;
  return { today, total: all.length, xp, level: Math.floor(xp / 100) + 1, toNext: 100 - (xp % 100) };
}
