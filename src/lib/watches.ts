import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { WaWatch } from "@/db/schema";

/**
 * "Waiting for a reply" on WhatsApp: when a teammate sends something it expects an
 * answer to, a watch is kept (wa_watches). The worker hands the reply to that
 * teammate, or reminds it when none comes in time (worker/replies.ts). A watched
 * conversation stays open for 7 days after the last activity, and replying in it
 * follows the teammate's freedom setting like an allowed chat.
 */

export const WATCH_ACTIVE_DAYS = 7;
const DAY = 86_400_000;

const activeSince = () => new Date(Date.now() - WATCH_ACTIVE_DAYS * DAY);

/** Watches still open: waiting, or replied and active in the last week. */
export function activeWatches(businessId: string, teammateId?: string) {
  return db
    .select()
    .from(schema.waWatches)
    .where(
      and(
        eq(schema.waWatches.businessId, businessId),
        inArray(schema.waWatches.status, ["waiting", "replied", "no_reply"]),
        or(gt(schema.waWatches.createdAt, activeSince()), gt(schema.waWatches.lastReplyAt, activeSince())),
        ...(teammateId ? [eq(schema.waWatches.teammateId, teammateId)] : []),
      ),
    )
    .orderBy(desc(schema.waWatches.createdAt))
    .all();
}

/** The open conversation with this chat, if any (it counts as approved for replies). */
export function activeWatchFor(businessId: string, jid: string) {
  return activeWatches(businessId).find((w) => w.jid === jid);
}

/** Start waiting for a reply (or refresh the wait if this teammate is already waiting on that chat). */
export function watchReply(p: {
  businessId: string;
  teammateId: string;
  taskId: string | null;
  jid: string;
  name: string;
  message: string;
  purpose?: string;
  hours?: number;
}) {
  const now = new Date();
  const replyBy = new Date(now.getTime() + Math.min(Math.max(p.hours ?? 24, 1), 24 * 14) * 3_600_000);
  const existing = activeWatches(p.businessId, p.teammateId).find((w) => w.jid === p.jid);
  if (existing) {
    db.update(schema.waWatches)
      .set({ status: "waiting", message: p.message, purpose: p.purpose || existing.purpose, replyBy, taskId: p.taskId ?? existing.taskId, seenUntil: now })
      .where(eq(schema.waWatches.id, existing.id))
      .run();
    return existing.id;
  }
  return db
    .insert(schema.waWatches)
    .values({ businessId: p.businessId, teammateId: p.teammateId, taskId: p.taskId, jid: p.jid, name: p.name, message: p.message, purpose: p.purpose ?? "", replyBy, seenUntil: now })
    .returning({ id: schema.waWatches.id })
    .get().id;
}

export function closeWatches(businessId: string, jid: string, teammateId?: string) {
  const ids = activeWatches(businessId, teammateId)
    .filter((w) => w.jid === jid)
    .map((w) => w.id);
  if (ids.length) db.update(schema.waWatches).set({ status: "closed" }).where(inArray(schema.waWatches.id, ids)).run();
  return ids.length;
}

/** "replied", "waiting", or "no reply" (none in time, or overdue). */
export function watchState(w: WaWatch) {
  if (w.status === "replied") return "replied" as const;
  if (w.status === "no_reply" || w.replyBy.getTime() < Date.now()) return "no reply" as const;
  return "waiting" as const;
}

function ago(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** One line per watch, for prompts and the manager's team_status. */
export function describeWatch(w: WaWatch, who?: string) {
  const state =
    w.status === "waiting"
      ? w.replyBy.getTime() < Date.now()
        ? "no reply yet (overdue)"
        : `waiting for a reply (until ${w.replyBy.toISOString().slice(0, 16).replace("T", " ")} UTC)`
      : w.status === "no_reply"
        ? "no reply in time"
        : `replied ${w.lastReplyAt ? ago(w.lastReplyAt) : ""}`;
  return `- ${w.name}${who ? `, messaged by ${who}` : ""} ${ago(w.createdAt)}${w.purpose ? ` about: ${w.purpose}` : ""}: ${state}`;
}
