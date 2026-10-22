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
import { isServablePath, newMediaPath } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { createTask } from "@/lib/tasks";
import { downloadMedia, isLinked, listMessages, sendFile, sendText, type WaMessage } from "@/lib/whatsapp";

const POLL_MS = 10_000;
/** Wait this long after a person's last message before handing the batch over. */
const QUIET_MS = 25_000;

/** Send text (and files from the business folder) to a human teammate, and record it. */
export async function sendToHuman(p: {
  business: Pick<Business, "id" | "name" | "language">;
  human: Teammate;
  from: Pick<Teammate, "id" | "name"> | null;
  text: string;
  files?: string[];
  taskId?: string | null;
  firstOfRequest?: boolean;
}) {
  if (!p.human.phone) throw new Error(`${p.human.name} has no WhatsApp number.`);
  const jid = humanJid(p.human.phone);
  const files = (p.files ?? []).filter((f) => isServablePath(f) && fs.existsSync(path.join(dataDir(), f)));
  const body = [senderLine(p.from, p.business.name, p.business.language), p.text.trim(), p.firstOfRequest ? replyHint(p.business.language) : ""]
    .filter(Boolean)
    .join("\n\n");
  await sendText(jid, body);
  for (const f of files) await sendFile(jid, path.join(dataDir(), f));
  recordHumanMessage({
    businessId: p.business.id,
    humanId: p.human.id,
    direction: "out",
    fromTeammateId: p.from?.id ?? null,
    taskId: p.taskId ?? null,
    text: p.text.trim(),
    attachments: files,
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

export function startHumanInbox() {
  stopHumanInbox();
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void pollAll()
      .catch((err) => console.error("[humans] poll failed", err))
      .finally(() => (busy = false));
  }, POLL_MS);
}

export function stopHumanInbox() {
  clearInterval(timer);
  timer = undefined;
}

async function pollAll() {
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.status, "active")).get();
  if (!business) return;
  const humans = listHumans(business.id).filter((h) => h.phone);
  if (!humans.length || !(await isLinked())) return;
  for (const h of humans) await pollHuman(business, h);
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
    .filter((m) => !m.FromMe && new Date(m.Timestamp) >= human.createdAt)
    .filter(
      (m) =>
        !db.select({ id: schema.humanMessages.id }).from(schema.humanMessages).where(eq(schema.humanMessages.waMessageId, m.MsgID)).get(),
    )
    .sort((a, b) => a.Timestamp.localeCompare(b.Timestamp));
  if (!fresh.length) return;
  // Still typing / sending files: wait for a quiet moment.
  if (Date.now() - new Date(fresh.at(-1)!.Timestamp).getTime() < QUIET_MS) return;

  const request = openRequest(human.id);
  const texts: string[] = [];
  const files: string[] = [];
  for (const m of fresh) {
    const attachments: string[] = [];
    if (m.MediaType) {
      const file = await saveMedia(jid, m).catch((err) => {
        console.error(`[humans] media download failed for ${m.MsgID}`, err);
        return null;
      });
      if (file) attachments.push(file);
    }
    const text = (m.Text || m.MediaCaption || m.DisplayText || "").trim();
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
    files.push(...attachments);
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
  routeReply(business, human, request, texts, files);
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
  const target = askingMate && askingMate.kind === "ai" && askingMate.status === "active" ? askingMate : getManager(business.id);
  if (!target) return;

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
  const about = request
    ? `${human.name} (human teammate) replied on WhatsApp to the request "${request.title}"${askingMate && target.id === askingMate.id ? " you sent" : ""}:`
    : `${human.name} (human teammate) sent a WhatsApp message (there's no open request to them):`;
  createTask({
    businessId: business.id,
    teammateId: target.id,
    title: `${human.name} replied${files.length ? ` (${files.length} file${files.length === 1 ? "" : "s"})` : ""}`,
    instructions: `${about}\n\n${said}`,
    createdBy: `${HUMAN}${human.id}`,
    // Keeps the manager's report chain: the follow-up belongs to the owner's request.
    parentTaskId: asking?.parentTaskId ?? null,
    attachments: files,
  });
  console.log(`[humans] ${human.name} replied → ${target.name}`);
}
