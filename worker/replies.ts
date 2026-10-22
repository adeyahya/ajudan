/**
 * Replies to WhatsApp messages the team is waiting on (src/lib/watches.ts). Runs with
 * the human-teammate inbox: for each open watch, new messages from the other side
 * (after a quiet moment) go to the teammate who wrote, as one task with the earlier
 * message, any photos/videos and voice notes transcribed. No reply by the deadline:
 * that teammate gets a reminder to follow up or tell the owner.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Business, WaWatch } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { getManager } from "@/lib/manager";
import { isAcknowledgement, listHumans } from "@/lib/humans";
import { createTask } from "@/lib/tasks";
import { activeWatches } from "@/lib/watches";
import { isRealMessage, listMessages } from "@/lib/whatsapp";
import { QUIET_MS, readIncoming } from "./humans";

export const REPLY = "system:reply";
/** Title prefix of the "no reply in time" reminder tasks (a cheap, quick decision). */
export const REMINDER_TITLE = "No reply yet from ";

export function isReminderTask(task: { createdBy: string; title: string }) {
  return task.createdBy === REPLY && task.title.startsWith(REMINDER_TITLE);
}

export async function pollWatches(business: Business) {
  const watches = activeWatches(business.id);
  if (!watches.length) return;
  // People on the team have their own inbox (worker/humans.ts).
  const humanJids = new Set(listHumans(business.id).map((h) => `${h.phone}@s.whatsapp.net`));
  for (const w of watches) {
    if (humanJids.has(w.jid)) continue;
    try {
      await pollWatch(business, w);
    } catch (err) {
      console.error(`[replies] ${w.name}`, err);
    }
  }
}

async function pollWatch(business: Business, w: WaWatch) {
  const fresh = (await listMessages(w.jid, { limit: 50, after: new Date(w.seenUntil.getTime() - 60_000).toISOString() }))
    .filter((m) => !m.FromMe && new Date(m.Timestamp) > w.seenUntil && isRealMessage(m))
    .sort((a, b) => a.Timestamp.localeCompare(b.Timestamp));

  if (!fresh.length) {
    if (w.status === "waiting" && w.replyBy.getTime() < Date.now()) remind(business, w);
    return;
  }
  // Still typing or sending files: wait for a quiet moment.
  if (Date.now() - new Date(fresh.at(-1)!.Timestamp).getTime() < QUIET_MS) return;

  const group = w.jid.endsWith("@g.us");
  const texts: string[] = [];
  const files: string[] = [];
  for (const m of fresh) {
    const { text, handOver } = await readIncoming(business, w.jid, m);
    if (text) texts.push(group ? `${m.SenderName || m.SenderJID.split("@")[0]}: ${text}` : text);
    files.push(...handOver);
  }
  const last = new Date(fresh.at(-1)!.Timestamp);
  const wasReplied = w.status === "replied";
  db.update(schema.waWatches).set({ status: "replied", seenUntil: last, lastReplyAt: last }).where(eq(schema.waWatches.id, w.id)).run();

  // "ok makasih" after the conversation already got its answer: nothing to do.
  if (wasReplied && !files.length && texts.length && texts.every((t) => isAcknowledgement(t.replace(/^[^:]+: /, "")))) return;

  const mate = db.select().from(schema.teammates).where(eq(schema.teammates.id, w.teammateId)).get();
  const target = mate && mate.status === "active" && mate.kind === "ai" ? mate : getManager(business.id);
  if (!target) return;
  const sentBy = db.select().from(schema.tasks).where(eq(schema.tasks.id, w.taskId ?? "")).get();
  const said = texts.length ? texts.map((t) => `> ${t.replace(/\n/g, "\n> ")}`).join("\n\n") : "(no text, only files)";
  const voice = texts.some((t) => t.includes("🎤"))
    ? "\n\n(🎤 marks a voice note, transcribed automatically: names, numbers and prices may be misheard.)"
    : "";
  createTask({
    businessId: business.id,
    teammateId: target.id,
    title: `${w.name} replied on WhatsApp`.slice(0, 80),
    createdBy: REPLY,
    // Part of the owner's request that sent the message, so the manager reports on it.
    parentTaskId: sentBy?.parentTaskId ?? null,
    attachments: files,
    instructions: `${w.name} replied on WhatsApp to the message ${target.id === w.teammateId ? "you" : (mate?.name ?? "the team")} sent${w.purpose ? ` (to get: ${w.purpose})` : ""}.

You wrote:
> ${w.message.slice(0, 1500).replace(/\n/g, "\n> ")}

${group ? "Replies in the group" : "Their reply"}:

${said}${voice}

Act on it: answer them if they asked something or the conversation should go on (send_message to "${w.jid}"; this conversation counts as approved, so it follows your freedom setting), save what you got, and tell the owner if they need to decide something. When the conversation is done, call stop_waiting so further messages aren't handed to you.`,
  });
  logEvent({ businessId: business.id, teammateId: target.id, type: "wa_reply", message: `${w.name} replied on WhatsApp${files.length ? ` with ${files.length} file(s)` : ""}`, data: { watchId: w.id } });
  console.log(`[replies] ${w.name} replied → ${target.name}`);
}

/** No answer in time: remind the teammate once (a late reply still gets handed over). */
function remind(business: Business, w: WaWatch) {
  db.update(schema.waWatches).set({ status: "no_reply" }).where(eq(schema.waWatches.id, w.id)).run();
  const mate = db.select().from(schema.teammates).where(eq(schema.teammates.id, w.teammateId)).get();
  const target = mate && mate.status === "active" && mate.kind === "ai" ? mate : getManager(business.id);
  if (!target) return;
  const sentBy = db.select().from(schema.tasks).where(eq(schema.tasks.id, w.taskId ?? "")).get();
  const hours = Math.round((w.replyBy.getTime() - w.createdAt.getTime()) / 3_600_000);
  createTask({
    businessId: business.id,
    teammateId: target.id,
    title: `${REMINDER_TITLE}${w.name}`.slice(0, 80),
    createdBy: REPLY,
    parentTaskId: sentBy?.parentTaskId ?? null,
    instructions: `${w.name} hasn't replied on WhatsApp within ${hours} h to the message you sent${w.purpose ? ` (to get: ${w.purpose})` : ""}:

> ${w.message.slice(0, 1500).replace(/\n/g, "\n> ")}

Decide what's best: one short, friendly follow-up (send_message to "${w.jid}", expect_reply again), another way to reach them, or tell the owner it's stuck. Don't nag: at most one follow-up. If it doesn't matter any more, call stop_waiting. A late reply will still reach you.`,
  });
  console.log(`[replies] no reply from ${w.name} → reminded ${target.name}`);
}
