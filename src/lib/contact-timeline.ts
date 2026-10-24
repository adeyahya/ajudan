import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ObjectType } from "@/db/schema";
import type { InteractionKind } from "@/lib/contacts";
import { humanJid } from "@/lib/humans";
import { describeRef, linksFor } from "@/lib/links";
import { historyFor } from "@/lib/object-history";
import { matchIds } from "@/lib/search";

/**
 * One contact's timeline, newest first: WhatsApp with them (the human-teammate thread
 * when they're on the team, and the team's watched chats with their number or name),
 * tasks and deliverables that mention them, links both ways, and their object_history:
 * logged interactions, follow-ups set/done, created, merged, trashed/restored. Every
 * source is bounded, so a busy contact costs a handful of indexed queries.
 */

export type TimelineKind = "whatsapp" | "watch" | "task" | "deliverable" | "link" | "interaction" | "follow_up" | "change";

export type TimelineItem = {
  /** Unique within the list (source-prefixed). */
  id: string;
  kind: TimelineKind;
  /** ISO time. */
  at: string;
  title: string;
  detail?: string;
  /** Who did it, as object_history writes it ("owner", "teammate:<id>", "system"), when known. */
  by?: string;
  /** The teammate's (or human teammate's) name, when there is one. */
  who?: string;
  status?: string;
  href?: string | null;
  direction?: "in" | "out";
  interaction?: InteractionKind;
  followUp?: "set" | "done" | "clear";
  /** The follow-up date the entry is about (ISO). */
  followUpAt?: string | null;
  change?: "create" | "delete" | "restore" | "merge";
  linkType?: ObjectType;
};

const iso = (d: Date) => d.toISOString();
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function contactTimeline(businessId: string, contactId: string, limit = 40): TimelineItem[] {
  const c = db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.businessId, businessId)))
    .get();
  if (!c) return [];
  const per = Math.max(5, Math.min(limit, 50));
  const mates = db.select({ id: schema.teammates.id, name: schema.teammates.name, phone: schema.teammates.phone, kind: schema.teammates.kind }).from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all();
  const nameOf = new Map(mates.map((m) => [m.id, m.name]));
  const byName = (by: string) => (by.startsWith("teammate:") ? nameOf.get(by.slice(9)) : undefined);
  const items: TimelineItem[] = [];

  // WhatsApp: the human-teammate thread when this contact is one of the team's people.
  if (c.phone) {
    const humans = mates.filter((m) => m.kind === "human" && m.phone === c.phone).map((m) => m.id);
    if (humans.length) {
      const hm = schema.humanMessages;
      for (const m of db.select().from(hm).where(inArray(hm.humanId, humans)).orderBy(desc(hm.sentAt)).limit(per).all()) {
        items.push({
          id: `wa:${m.id}`,
          kind: "whatsapp",
          at: iso(m.sentAt),
          // Empty for a media-only message; the UI says so.
          title: short(m.text),
          direction: m.direction,
          who: m.direction === "out" ? (m.fromTeammateId ? nameOf.get(m.fromTeammateId) : undefined) : c.name,
          by: m.direction === "out" ? (m.fromTeammateId ? `teammate:${m.fromTeammateId}` : "owner") : undefined,
          href: `/b/${businessId}/teammates/${m.humanId}`,
        });
      }
    }
  }

  // Chats the team watches for an answer, by their number or their exact name.
  const w = schema.waWatches;
  const watchMatch = [like(w.name, c.name), ...(c.phone ? [eq(w.jid, humanJid(c.phone))] : [])];
  for (const x of db.select().from(w).where(and(eq(w.businessId, businessId), or(...watchMatch))).orderBy(desc(w.createdAt)).limit(Math.ceil(per / 2)).all()) {
    items.push({
      id: `watch:${x.id}`,
      kind: "watch",
      at: iso(x.lastSentAt ?? x.createdAt),
      title: short(x.purpose || x.message),
      detail: x.purpose && x.message ? short(x.message) : undefined,
      status: x.status,
      direction: "out",
      who: nameOf.get(x.teammateId),
      by: `teammate:${x.teammateId}`,
      href: `/b/${businessId}/desk`,
    });
    if (x.lastReplyAt) items.push({ id: `watch-reply:${x.id}`, kind: "watch", at: iso(x.lastReplyAt), title: short(x.purpose || x.message), status: "replied", direction: "in", who: c.name, href: `/b/${businessId}/desk` });
  }

  // Tasks that mention their name or number.
  const words = [c.name, ...(c.phone ? [c.phone, c.phone.slice(-9)] : [])].filter((x) => x.trim().length > 2);
  if (words.length) {
    const t = schema.tasks;
    for (const k of db
      .select({ id: t.id, title: t.title, teammateId: t.teammateId, status: t.status, createdAt: t.createdAt })
      .from(t)
      .where(and(eq(t.businessId, businessId), or(...words.flatMap((x) => [like(t.instructions, `%${x}%`), like(t.result, `%${x}%`)]))))
      .orderBy(desc(t.createdAt))
      .limit(Math.ceil(per / 2))
      .all()) {
      items.push({ id: `task:${k.id}`, kind: "task", at: iso(k.createdAt), title: k.title, status: k.status, who: nameOf.get(k.teammateId), by: `teammate:${k.teammateId}`, href: `/b/${businessId}/teammates/${k.teammateId}` });
    }
  }

  // Deliverables that mention their name (the search index when the name is long enough).
  if (c.name.trim().length > 2) {
    const d = schema.deliverables;
    const ids = matchIds("deliverables", businessId, [c.name.trim()], { limit: 8 });
    const where = ids ? (ids.length ? inArray(d.id, ids) : undefined) : or(like(d.title, `%${c.name}%`), like(d.content, `%${c.name}%`));
    if (where) {
      for (const x of db
        .select({ id: d.id, title: d.title, status: d.status, teammateId: d.teammateId, createdAt: d.createdAt })
        .from(d)
        .where(and(eq(d.businessId, businessId), isNull(d.deletedAt), where))
        .orderBy(desc(d.createdAt))
        .limit(8)
        .all()) {
        items.push({
          id: `deliverable:${x.id}`,
          kind: "deliverable",
          at: iso(x.createdAt),
          title: x.title,
          status: x.status,
          who: x.teammateId ? nameOf.get(x.teammateId) : undefined,
          href: `/b/${businessId}/docs?doc=${x.id}`,
        });
      }
    }
  }

  // Links both ways.
  for (const l of linksFor(businessId, { type: "contact", id: contactId }).slice(0, per)) {
    const info = describeRef(businessId, l);
    if (!info || info.deleted) continue;
    items.push({
      id: `link:${l.linkId}:${l.direction}`,
      kind: "link",
      at: iso(l.createdAt),
      title: info.title,
      linkType: l.type,
      direction: l.direction,
      href: info.href,
      by: l.createdBy,
      who: byName(l.createdBy),
    });
  }

  // History: this contact's, plus interactions of contacts merged into it.
  const own = historyFor(businessId, "contact", contactId, 200);
  const mergedFrom = [...new Set(own.flatMap((h) => (Array.isArray(h.snapshot.mergedFrom) ? (h.snapshot.mergedFrom as string[]) : [])))];
  const absorbed = mergedFrom.flatMap((id) => historyFor(businessId, "contact", id, 100).filter((h) => h.snapshot.interaction));
  for (const h of [...own, ...absorbed]) {
    const base = { at: iso(h.createdAt), by: h.by, who: byName(h.by) };
    const s = h.snapshot;
    const interaction = s.interaction as { kind?: InteractionKind; text?: string } | undefined;
    const followUp = s.followUp as { action?: "set" | "done" | "clear"; at?: string | null; note?: string } | undefined;
    if (interaction?.text) items.push({ ...base, id: `h:${h.id}`, kind: "interaction", title: short(interaction.text, 600), interaction: interaction.kind ?? "note" });
    else if (followUp?.action) items.push({ ...base, id: `h:${h.id}`, kind: "follow_up", title: followUp.note ?? "", followUp: followUp.action, followUpAt: followUp.at ?? null });
    else if (Array.isArray(s.mergedFrom)) items.push({ ...base, id: `h:${h.id}`, kind: "change", title: c.name, change: "merge", detail: String(s.mergedFrom.length) });
    else if (h.action !== "update") items.push({ ...base, id: `h:${h.id}`, kind: "change", title: c.name, change: h.action });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, limit);
}
