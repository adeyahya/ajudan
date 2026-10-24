/**
 * Human teammates on WhatsApp (see src/lib/humans.ts):
 *  - runHumanRequest sends a request (a task assigned to a human) from the business's
 *    WhatsApp and leaves it "waiting_human";
 *  - the inbox polls each human's chat, waits until they've finished sending (a person
 *    sends five clips and a caption as six messages), copies photos and videos into
 *    media/, and hands the batch to whoever asked as one new task.
 */
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Business, Task, Teammate } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { HUMAN, humanJid, isAcknowledgement, listHumans, openRequest, recordHumanMessage, replyHint, senderLine } from "@/lib/humans";
import { getManager } from "@/lib/manager";
import { isServablePath, mediaKind, newMediaPath } from "@/lib/media";
import { transcribe } from "@/lib/speech";
import { pollWatches } from "./replies";
import { handleOwnerAnswers, isApprovalAnswer } from "./owner-approvals";
import { dataDir } from "@/lib/paths";
import { createTask } from "@/lib/tasks";
import { QUIET_BY_PACE } from "@/lib/watches";
import { onIncomingMessage } from "./whatsapp-sync";
import { downloadMedia, isLinked, isRealMessage, listMessages, messageText, sendFile, sendText, sendVoice, type WaMessage } from "@/lib/whatsapp";
import { speak, speakable, voiceAvailable } from "@/lib/voice";
import { voiceSettings } from "@/lib/voice-settings";

const POLL_MS = 10_000;
/** Wait this long after a person's last message before handing the batch over. */
export const QUIET_MS = 25_000;

/**
 * Send text (and files from the business folder) to a human teammate, and record it.
 * With voice replies on (Business → WhatsApp), a voice note goes first: always, or
 * when their last message was one. `spoken` is what it says (else the text, made
 * speakable); `voice: false` keeps a message text-only (approval requests).
 */
export async function sendToHuman(p: {
  business: Pick<Business, "id" | "name" | "language">;
  human: Teammate;
  from: Pick<Teammate, "id" | "name"> | null;
  text: string;
  files?: string[];
  taskId?: string | null;
  firstOfRequest?: boolean;
  spoken?: string;
  voice?: boolean;
}) {
  if (!p.human.phone) throw new Error(`${p.human.name} has no WhatsApp number.`);
  const jid = humanJid(p.human.phone);
  const files = (p.files ?? []).filter((f) => isServablePath(f) && fs.existsSync(path.join(dataDir(), f)));
  const body = [senderLine(p.from, p.business.name, p.business.language), p.text.trim(), p.firstOfRequest ? replyHint(p.business.language) : ""]
    .filter(Boolean)
    .join("\n\n");
  const noVoice = voiceBlocked(p.business.id);
  const voiceNote = noVoice || p.voice === false || (p.voice !== true && !wantsVoice(p.business.id, p.human.id)) ? null : await voiceNoteFor(p, jid);
  await sendText(jid, body);
  for (const f of files) await sendFile(jid, path.join(dataDir(), f));
  recordHumanMessage({
    businessId: p.business.id,
    humanId: p.human.id,
    direction: "out",
    fromTeammateId: p.from?.id ?? null,
    taskId: p.taskId ?? null,
    text: p.text.trim(),
    attachments: voiceNote ? [voiceNote, ...files] : files,
    sentAt: new Date(),
  });
  logEvent({
    businessId: p.business.id,
    teammateId: p.from?.id ?? null,
    taskId: p.taskId ?? null,
    type: "human_message_sent",
    message: `${p.from?.name ?? "You"} → ${p.human.name} on WhatsApp: ${p.text.replace(/\s+/g, " ").slice(0, 100)}`,
    data: { humanId: p.human.id },
  });
  return {
    voiceNote,
    /** Why no voice note could go, if one was asked for. */
    noVoice: noVoice ?? (voiceNote ? undefined : "making the voice note failed; the text went."),
  };
}

/**
 * Why this business can't send voice notes at all, or null when it can: switched off
 * (Business → WhatsApp → Voice replies) or not set up on this Mac.
 */
export function voiceBlocked(businessId: string): string | null {
  const row = db.select({ v: schema.businesses.voiceReplies }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (voiceSettings(row?.v).mode === "off") return "voice replies are switched off for this business (the owner can turn them on in Business → WhatsApp → Voice replies); the text went.";
  if (!voiceAvailable()) return "the voice isn't set up on this Mac yet (the owner runs `pnpm voice:setup` in the Ajudan folder); the text went.";
  return null;
}

/** Voice replies are on for this business, and this person gets one now. */
export function wantsVoice(businessId: string, humanId: string) {
  const row = db.select({ v: schema.businesses.voiceReplies }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  const mode = voiceSettings(row?.v).mode;
  if (voiceBlocked(businessId)) return false;
  if (mode === "always") return true;
  const lastIn = db
    .select({ text: schema.humanMessages.text })
    .from(schema.humanMessages)
    .where(and(eq(schema.humanMessages.humanId, humanId), eq(schema.humanMessages.direction, "in")))
    .orderBy(desc(schema.humanMessages.sentAt))
    .get();
  return lastIn?.text.startsWith("🎤") ?? false;
}

/** Make and send the voice note; a failure only costs the voice (the text still goes). */
async function voiceNoteFor(p: { business: Pick<Business, "id" | "language">; human: Teammate; from: Pick<Teammate, "id" | "name"> | null; text: string; spoken?: string }, jid: string) {
  const say = speakable(p.spoken?.trim() || p.text);
  if (!say) return null;
  try {
    const row = db.select({ v: schema.businesses.voiceReplies }).from(schema.businesses).where(eq(schema.businesses.id, p.business.id)).get();
    const rel = await speak(say, voiceSettings(row?.v), p.business.language);
    await sendVoice(jid, path.join(dataDir(), rel));
    return rel;
  } catch (err) {
    console.error(`[humans] voice note to ${p.human.name} failed`, err);
    logEvent({ businessId: p.business.id, teammateId: p.from?.id ?? null, type: "text", message: `Couldn't send ${p.human.name} a voice note (${(err as Error).message.slice(0, 120)}); sent text only.` });
    return null;
  }
}

/** A task assigned to a human: send it on WhatsApp and wait for their reply. */
export async function runHumanRequest(task: Task, human: Teammate, business: Business) {
  const from = task.createdBy.startsWith("teammate:")
    ? (db.select().from(schema.teammates).where(eq(schema.teammates.id, task.createdBy.slice(9))).get() ?? null)
    : null;
  try {
    if (!(await isLinked())) throw new Error("The business's WhatsApp isn't linked (Business → WhatsApp).");
    await sendToHuman({ business, human, from, text: task.instructions, files: task.attachments, taskId: task.id, firstOfRequest: true });
  } catch (err) {
    const message = (err as Error).message;
    db.update(schema.tasks)
      .set({ status: "failed", result: `Couldn't send on WhatsApp: ${message}`, finishedAt: new Date() })
      .where(eq(schema.tasks.id, task.id))
      .run();
    logEvent({ businessId: business.id, teammateId: human.id, taskId: task.id, type: "task_failed", message: `Couldn't message ${human.name}: ${message}` });
    return;
  }
  db.update(schema.tasks).set({ status: "waiting_human", startedAt: new Date() }).where(eq(schema.tasks.id, task.id)).run();
  db.update(schema.teammates)
    .set({ state: "waiting", currentActivity: `Asked on WhatsApp: ${task.title}`.slice(0, 140) })
    .where(eq(schema.teammates.id, human.id))
    .run();
  logEvent({
    businessId: business.id,
    teammateId: human.id,
    taskId: task.id,
    type: "human_request_sent",
    message: `${from?.name ?? "You"} asked ${human.name} on WhatsApp: ${task.title}`,
  });
}

// ---- inbox ----

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let again = false;
const wakes = new Set<ReturnType<typeof setTimeout>>();

/** Poll now (or right after the poll that's running). */
function poll() {
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  void pollAll()
    .catch((err) => console.error("[humans] poll failed", err))
    .finally(() => {
      busy = false;
      if (again) {
        again = false;
        poll();
      }
    });
}

function wake(ms: number) {
  const t = setTimeout(() => {
    wakes.delete(t);
    poll();
  }, ms);
  wakes.add(t);
}

/**
 * A message just came in (the sync's webhook): look now, and again when each quiet
 * window ends, so a live chat is handed over seconds after they stop typing.
 */
let lastNudge = 0;

function onMessage() {
  // A burst (history catch-up, an album) needs one set of checks, not one per message.
  if (!timer || Date.now() - lastNudge < 500) return;
  lastNudge = Date.now();
  for (const ms of new Set([1_000, QUIET_BY_PACE.live, QUIET_BY_PACE.normal, QUIET_MS])) wake(ms + 1_000);
}

export function startHumanInbox() {
  stopHumanInbox();
  timer = setInterval(() => {
    if (!busy) poll();
  }, POLL_MS);
  onIncomingMessage(onMessage);
}

export function stopHumanInbox() {
  clearInterval(timer);
  timer = undefined;
  for (const t of wakes) clearTimeout(t);
  wakes.clear();
}

async function pollAll() {
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.status, "active")).get();
  if (!business) return;
  const humans = listHumans(business.id).filter((h) => h.phone);
  if (!(await isLinked())) return;
  for (const h of humans) await pollHuman(business, h);
  // Replies to messages the team is waiting on (worker/replies.ts).
  await pollWatches(business);
}

async function pollHuman(business: Business, human: Teammate) {
  const lastIn = db
    .select({ at: schema.humanMessages.sentAt })
    .from(schema.humanMessages)
    .where(and(eq(schema.humanMessages.humanId, human.id), eq(schema.humanMessages.direction, "in")))
    .orderBy(desc(schema.humanMessages.sentAt))
    .get()?.at;
  // Never import old history: start from when they joined the team.
  const since = new Date(Math.max((lastIn ?? human.createdAt).getTime() - 60_000, human.createdAt.getTime()));
  const jid = humanJid(human.phone!);
  const fresh = (await listMessages(jid, { limit: 50, after: since.toISOString() }))
    // Emoji reactions aren't replies.
    .filter((m) => !m.FromMe && new Date(m.Timestamp) >= human.createdAt && isRealMessage(m))
    .filter(
      (m) =>
        !db.select({ id: schema.humanMessages.id }).from(schema.humanMessages).where(eq(schema.humanMessages.waMessageId, m.MsgID)).get(),
    )
    .sort((a, b) => a.Timestamp.localeCompare(b.Timestamp));
  if (!fresh.length) return;
  // Still typing / sending files: wait for a quiet moment (the owner's "ya A7F2" doesn't wait).
  const isOwner = business.ownerHumanId === human.id;
  // When the owner's last message is "ya A7F2", they're done: handle the batch now.
  const quickAnswer = isOwner && isApprovalAnswer(messageText(fresh.at(-1)!));
  if (!quickAnswer && Date.now() - new Date(fresh.at(-1)!.Timestamp).getTime() < QUIET_MS) return;

  const request = openRequest(human.id);
  const texts: string[] = [];
  const files: string[] = [];
  for (const m of fresh) {
    const { text, attachments, handOver } = await readIncoming(business, jid, m);
    recordHumanMessage({
      businessId: business.id,
      humanId: human.id,
      direction: "in",
      taskId: request?.id ?? null,
      text: text || (m.MediaType ? `[${m.MediaType}]` : ""),
      attachments,
      waMessageId: m.MsgID,
      sentAt: new Date(m.Timestamp),
    });
    if (text) texts.push(text);
    files.push(...handOver);
  }
  logEvent({
    businessId: business.id,
    teammateId: human.id,
    taskId: request?.id ?? null,
    type: "human_replied",
    message: `${human.name} replied on WhatsApp${files.length ? ` with ${files.length} file(s)` : ""}`,
  });
  db.update(schema.teammates)
    .set({ state: request ? "waiting" : "idle", currentActivity: `Replied on WhatsApp${files.length ? ` (${files.length} files)` : ""}` })
    .where(eq(schema.teammates.id, human.id))
    .run();
  // The owner can approve or reject on WhatsApp; anything else goes on as usual.
  const rest = isOwner ? await handleOwnerAnswers(business, human, texts) : texts;
  if (!rest.length && !files.length) return;
  routeReply(business, human, request, rest, files);
}

/**
 * One incoming WhatsApp message as the team should see it: its text, its photos and
 * videos saved to media/, and a voice note transcribed (the transcript stands in for
 * the audio, so `handOver` leaves it out).
 */
export async function readIncoming(business: Pick<Business, "language">, jid: string, m: WaMessage) {
  const attachments: string[] = [];
  if (m.MediaType) {
    const file = await saveMedia(jid, m).catch((err) => {
      console.error(`[whatsapp] media download failed for ${m.MsgID}`, err);
      return null;
    });
    if (file) attachments.push(file);
  }
  let text = messageText(m);
  const audio = attachments.find((f) => mediaKind(f) === "audio");
  const voice = !!audio && !text;
  if (voice) {
    try {
      const t = await transcribe(path.join(dataDir(), audio), { language: business.language });
      text = t.text ? `🎤 ${t.text}` : "🎤 (voice note without words)";
    } catch (err) {
      console.error(`[whatsapp] couldn't transcribe ${audio}`, err);
      text = `🎤 (voice note: ${audio}; it couldn't be transcribed: ${(err as Error).message.slice(0, 120)})`;
    }
  }
  return { text, attachments, handOver: voice ? attachments.filter((f) => f !== audio) : attachments };
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
};

async function saveMedia(jid: string, m: WaMessage) {
  const ext = path.extname(m.Filename || "").toLowerCase() || MIME_EXT[(m.MimeType ?? "").split(";")[0]] || "";
  if (!ext) return null;
  const base = m.Filename ? path.basename(m.Filename, path.extname(m.Filename)) : `whatsapp-${m.MediaType}`;
  const rel = newMediaPath(`${base}${ext}`);
  const abs = path.join(dataDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const d = await downloadMedia(jid, m.MsgID, abs);
  if (d.path && path.resolve(d.path) !== abs && fs.existsSync(d.path)) fs.renameSync(d.path, abs);
  return fs.existsSync(abs) ? rel : null;
}

/**
 * Hand the reply to whoever asked: the AI teammate whose task sent the request, or
 * the manager (owner's requests and messages out of the blue). If that teammate's
 * follow-up is still queued, add to it instead of starting another run.
 */
/** Words people put before a name ("Mbak Sari", "Kak Ajeng"). */
const HONORIFICS = new Set(["mas", "mbak", "kak", "ka", "bu", "ibu", "pak", "bapak", "bang", "dek", "om", "tante", "hi", "hai", "halo", "hey", "hello", "dear"]);

/**
 * The AI teammate a message is addressed to, by its opening word: the name ("Ajeng"),
 * or the tail people shorten it to when calling someone ("Jeng," for Ajeng: needs the
 * comma, so "ini laporannya" isn't for Rini), after an honorific ("Mbak Sari").
 * Null when it doesn't open with a name.
 */
export function addressedTeammate(texts: string[], businessId: string): Teammate | null {
  const first = (texts[0] ?? "").replace(/^🎤\s*/, "").trim().toLowerCase();
  const words = first.split(/[\s,.:;!?]+/).filter(Boolean).slice(0, 3);
  const word = words.find((w) => !HONORIFICS.has(w));
  if (!word || word.length < 3) return null;
  const calling = new RegExp(`^(?:\\S+\\s+){0,2}?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`).test(first);
  const mates = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active"), eq(schema.teammates.kind, "ai")))
    .all();
  const full = mates.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === word);
  if (full.length === 1) return full[0];
  const short = mates.filter((m) => m.name.toLowerCase().split(/\s+/)[0].endsWith(word));
  return calling && full.length === 0 && short.length === 1 ? short[0] : null;
}

function routeReply(business: Business, human: Teammate, request: Task | undefined, texts: string[], files: string[]) {
  // "oke sinta", "makasih 🙏" after the work is wrapped up: recorded in the conversation,
  // but no one needs to act. ("iya" to an open request or a question is an answer.)
  const names = db.select({ name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.businessId, business.id)).all().map((t) => t.name);
  const lastOut = db
    .select({ text: schema.humanMessages.text })
    .from(schema.humanMessages)
    .where(and(eq(schema.humanMessages.humanId, human.id), eq(schema.humanMessages.direction, "out")))
    .orderBy(desc(schema.humanMessages.sentAt))
    .get();
  const askedSomething = !!lastOut && /\?\s*\S{0,3}\s*$/.test(lastOut.text.trim());
  if (!request && !askedSomething && !files.length && texts.length && texts.every((t) => isAcknowledgement(t, names))) {
    console.log(`[humans] ${human.name}: acknowledgement only, not handed over`);
    return;
  }
  const asking = request?.parentTaskId
    ? db.select().from(schema.tasks).where(eq(schema.tasks.id, request.parentTaskId)).get()
    : undefined;
  const askingMate = asking ? db.select().from(schema.teammates).where(eq(schema.teammates.id, asking.teammateId)).get() : undefined;
  // "Jeng, kabarin Yosa…": a message that starts with a teammate's name goes to them,
  // even while someone else waits on this person's answer.
  const named = addressedTeammate(texts, business.id);
  const target = named ?? (askingMate && askingMate.kind === "ai" && askingMate.status === "active" ? askingMate : getManager(business.id));
  if (!target) return;
  const fromAsking = !!askingMate && target.id === askingMate.id;

  const said = texts.length ? texts.map((t) => `> ${t.replace(/\n/g, "\n> ")}`).join("\n\n") : "(no text, only files)";
  const queued = db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.teammateId, target.id), eq(schema.tasks.createdBy, `${HUMAN}${human.id}`), eq(schema.tasks.status, "queued")))
    .get();
  if (queued) {
    db.update(schema.tasks)
      .set({ instructions: `${queued.instructions}\n\nThen ${human.name} also sent:\n\n${said}`, attachments: [...queued.attachments, ...files] })
      .where(eq(schema.tasks.id, queued.id))
      .run();
    return;
  }
  const about =
    request && (fromAsking || !named)
      ? `${human.name} (human teammate) replied on WhatsApp to the request "${request.title}"${fromAsking ? " you sent" : ""}:`
      : named
        ? `${human.name} (human teammate) sent you a WhatsApp message, addressed to you by name:`
        : `${human.name} (human teammate) sent a WhatsApp message (there's no open request to them):`;
  const voiceHint = texts.some((t) => t.startsWith("🎤"))
    ? "\n\n(🎤 marks a voice note, transcribed automatically: names, numbers and prices may be misheard. Confirm anything important before acting on it.)"
    : "";
  createTask({
    businessId: business.id,
    teammateId: target.id,
    title: `${human.name} replied${files.length ? ` (${files.length} file${files.length === 1 ? "" : "s"})` : ""}`,
    instructions: `${about}\n\n${said}${voiceHint}`,
    createdBy: `${HUMAN}${human.id}`,
    // Keeps the manager's report chain: the follow-up belongs to the owner's request.
    parentTaskId: fromAsking ? (asking?.parentTaskId ?? null) : null,
    // The teammate that asked carries on in the same conversation.
    sessionId: asking && target.id === asking.teammateId ? asking.sessionId : null,
    attachments: files,
  });
  console.log(`[humans] ${human.name} replied → ${target.name}`);
}
