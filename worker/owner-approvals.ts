/**
 * Approvals on WhatsApp for the owner (businesses.ownerHumanId, a person on the team).
 * Every new approval request is also sent to the owner's WhatsApp with a short code;
 * the owner answers "ya A7F2" / "tidak A7F2 <why>" (a bare "ya" works for the request
 * just sent). Decisions go through the same path as the Approvals page (src/lib/approvals.ts).
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Approval, Business, Teammate } from "@/db/schema";
import { approvalCode, decide, findPendingByCode } from "@/lib/approvals";
import { CAPABILITY, type CapabilityRequest } from "@/lib/capabilities";
import { isServablePath, mediaKind } from "@/lib/media";
import { isLinked } from "@/lib/whatsapp";
import { sendToHuman } from "./humans";

export const YES = /^\s*(ya|iya|y|yes|ok|oke|okay|setuju|approve|approved|acc|gas|lanjut|boleh)\b[\s,.:!-]*(semua|all|#?[0-9a-f]{4}\b)?[\s,.:!-]*([\s\S]*)$/i;
export const NO = /^\s*(tidak|nggak|gak|enggak|ga|no|n|tolak|reject|rejected|jangan|batal)\b[\s,.:!-]*(semua|all|#?[0-9a-f]{4}\b)?[\s,.:!-]*([\s\S]*)$/i;
const PROMPT = "🔔";

const t = (business: Pick<Business, "language">, id: string, en: string) => (business.language === "id" ? id : en);

export function ownerOf(business: Pick<Business, "ownerHumanId">) {
  if (!business.ownerHumanId) return undefined;
  const h = db.select().from(schema.teammates).where(eq(schema.teammates.id, business.ownerHumanId)).get();
  return h && h.kind === "human" && h.status === "active" && h.phone ? h : undefined;
}

/**
 * What the owner needs to see to decide: the exact text that would go out, and the
 * pictures or videos with it (at most 3, so the owner isn't flooded).
 */
function details(a: Approval): { text: string; files: string[] } {
  const i = a.input as Record<string, unknown>;
  const s = (v: unknown, n = 700) => String(v ?? "").trim().slice(0, n);
  const visual = (paths: string[]) => paths.filter((f) => isServablePath(f) && ["image", "video"].includes(mediaKind(f))).slice(0, 3);
  if (a.toolName === CAPABILITY) return { text: s((i as CapabilityRequest).why, 300), files: [] };
  // Old rows from before the publish tool was replaced by mark_ready_to_post.
  if (a.toolName.endsWith("__publish_deliverable")) {
    const d = db.select().from(schema.deliverables).where(eq(schema.deliverables.id, String(i.deliverable_id ?? ""))).get();
    return d ? { text: `*${d.title}*\n${s(d.content)}`, files: visual(d.attachments) } : { text: "", files: [] };
  }
  // WhatsApp send_file: a path in the teammate's folder; work/ and media/ are the business folder's files.
  const files = typeof i.file === "string" ? visual([i.file]) : [];
  return { text: s(i.message ?? i.body ?? i.details ?? i.caption ?? i.action ?? ""), files };
}

/** Send a new approval request to the owner's WhatsApp (if set up). */
export async function notifyOwner(approvalId: string) {
  const a = db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId)).get();
  if (!a || a.status !== "pending") return;
  const business = db.select().from(schema.businesses).where(eq(schema.businesses.id, a.businessId)).get();
  const owner = business && ownerOf(business);
  if (!business || !owner || !(await isLinked())) return;
  const code = approvalCode(a);
  const secret = a.toolName === CAPABILITY && (a.input as CapabilityRequest).kind === "secret";
  const { text: body, files } = details(a);
  const how = secret
    ? t(business, "Ini kunci/API key: masukkan lewat aplikasi (halaman Approvals), jangan lewat chat.", "This is an API key: enter it in the app (Approvals page), never in a chat.")
    : t(business, `Balas *ya ${code}* untuk setuju, atau *tidak ${code}* + alasannya.`, `Reply *yes ${code}* to approve, or *no ${code}* + why.`);
  const text = `${PROMPT} *${t(business, "Perlu persetujuan", "Needs your approval")}* · ${code}\n${a.summary}${body ? `\n\n${body}` : ""}\n\n${how}`;
  try {
    await sendToHuman({ business, human: owner, from: null, text, files });
  } catch (err) {
    console.error("[owner-approvals] couldn't notify the owner", err);
  }
}

// A refusal right after a yes-word ("ya tidak jadi", "iya, jangan dulu") wins; "ok gapapa" stays a yes.
const NO_AFTER_YES = /^(tidak|nggak|gak|enggak|ga|jangan|batal|tolak)\b(?![\s-]*(apa|papa|masalah))/i;

/**
 * The owner's answer: decision, target ("a7f2", "semua"/"all" or "") and note, or null.
 * A 4-character word after the yes/no counts as a code only when it mixes digits and
 * letters ("A7F2") or is an open request's code, so "ok cabe 5kg" and "ok 1000 pcs" are notes.
 */
export function parseAnswer(raw: string, isOpenCode: (code: string) => boolean) {
  const text = raw.replace(/^🎤\s*/, "");
  const yes = YES.exec(text);
  let m = yes ?? NO.exec(text);
  if (!m) return null;
  let decision: "approved" | "rejected" = yes ? "approved" : "rejected";
  if (yes) {
    const rest = text.replace(/^\s*/, "").slice(yes[1].length).replace(/^[\s,.:!-]+/, "");
    if (NO_AFTER_YES.test(rest)) {
      m = NO.exec(rest) ?? m;
      decision = "rejected";
    }
  }
  const word = (m[2] ?? "").replace("#", "");
  let target = word.toLowerCase();
  let note = (m[3] ?? "").trim();
  const mixed = /\d/.test(target) && /[a-f]/.test(target);
  if (target && target !== "semua" && target !== "all" && !mixed && !isOpenCode(target)) {
    note = [word, note].filter(Boolean).join(" ");
    target = "";
  }
  // "ya?" is a question back, not an answer.
  if (!target && note.startsWith("?")) return null;
  return { decision, target, note };
}

/** Is this message only an approval answer (so it can be handled without the usual wait)? */
export function isApprovalAnswer(text: string) {
  return parseAnswer(text, () => true) !== null;
}

/**
 * Apply the owner's yes/no answers among their new messages. Returns the messages that
 * weren't answers (they go to the manager as usual).
 */
export async function handleOwnerAnswers(business: Business, owner: Teammate, texts: string[]) {
  const rest: string[] = [];
  const pending = () =>
    db.select().from(schema.approvals).where(and(eq(schema.approvals.businessId, business.id), eq(schema.approvals.status, "pending"))).all();
  const lastOut = db
    .select({ text: schema.humanMessages.text })
    .from(schema.humanMessages)
    .where(and(eq(schema.humanMessages.humanId, owner.id), eq(schema.humanMessages.direction, "out")))
    .orderBy(desc(schema.humanMessages.sentAt))
    .get();
  const answeringPrompt = !!lastOut?.text.startsWith(PROMPT);
  const reply = (text: string) => sendToHuman({ business, human: owner, from: null, text }).catch((err) => console.error("[owner-approvals]", err));

  for (const raw of texts) {
    const answer = parseAnswer(raw, (code) => findPendingByCode(business.id, code).length > 0);
    if (!answer) {
      rest.push(raw);
      continue;
    }
    const { decision, target } = answer;
    const note = answer.note || null;
    // "ok, sekarang bikin post buat TikTok…" without a code is an instruction, not an answer.
    if (!target && note && note.split(/\s+/).length > 8) {
      rest.push(raw);
      continue;
    }
    const open = pending();
    let chosen: Approval[] = [];
    if (target === "semua" || target === "all") chosen = open;
    else if (target) chosen = findPendingByCode(business.id, target);
    else if (answeringPrompt && open.length === 1) chosen = open;
    else {
      // Not clearly an answer to an approval: treat it as a normal message.
      if (!target && !answeringPrompt) {
        rest.push(raw);
        continue;
      }
      await reply(
        open.length
          ? t(business, `Yang mana? Masih menunggu: ${open.map((a) => `*${approvalCode(a)}* ${a.summary}`).join("; ")}. Balas dengan kodenya, mis. *ya ${approvalCode(open[0])}*.`, `Which one? Still waiting: ${open.map((a) => `*${approvalCode(a)}* ${a.summary}`).join("; ")}. Reply with its code, e.g. *yes ${approvalCode(open[0])}*.`)
          : t(business, "Tidak ada yang menunggu persetujuan sekarang.", "Nothing is waiting for your approval right now."),
      );
      continue;
    }
    if (!chosen.length) {
      await reply(t(business, `Kode *${target.toUpperCase()}* tidak ditemukan atau sudah diputuskan.`, `No open request with code *${target.toUpperCase()}* (or it was already decided).`));
      continue;
    }
    for (const a of chosen) {
      const r = await decide({ businessId: business.id, approvalId: a.id, decision, note, via: "whatsapp" });
      await reply(
        r.ok
          ? decision === "approved"
            ? `✅ ${t(business, "Disetujui", "Approved")}: ${a.summary}`
            : `❌ ${t(business, "Ditolak", "Rejected")}: ${a.summary}${note ? ` (“${note}”)` : ""}`
          : `⚠️ ${approvalCode(a)}: ${r.error}`,
      );
    }
  }
  return rest;
}
