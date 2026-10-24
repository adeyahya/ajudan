/**
 * Contact tools for the "biz" MCP server (registered in worker/tools.ts): a person's
 * timeline, logging a call/meeting/note/message, setting or completing a follow-up, and
 * reading the owner's saved segments. Access follows businesses.agent_access.contacts
 * (src/lib/agent-access.ts): "read" allows the read tools; logging and follow-ups are
 * additive, so "suggest" allows them too. Every change is recorded as the teammate's.
 */
import { tool, type SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Contact } from "@/db/schema";
import { canAgent } from "@/lib/agent-access";
import { contactTimeline, type TimelineItem } from "@/lib/contact-timeline";
import { getSegment, listSegments, segmentContacts } from "@/lib/contact-segments";
import { completeFollowUp, describeContact, getContact, INTERACTION_KINDS, logInteraction, searchAddressBook, setFollowUp, type InteractionKind } from "@/lib/contacts";
import { logEvent } from "@/lib/events";

export const CONTACT_TOOL_NAMES = ["contact_timeline", "log_interaction", "set_follow_up", "list_segment"] as const;

export type ContactToolsContext = { businessId: string; teammate: { id: string; name: string }; taskId: string };

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const READ_OFF = "The owner has closed the address book to the team.";
const WRITE_OFF = "The owner lets the team only read contacts. Tell the owner instead, or ask them to let the team suggest changes to contacts.";

/** The contact a teammate means: an id, else the one search match (or a list to choose from). */
function resolve(businessId: string, who: string): { contact: Contact } | { error: string } {
  const byId = getContact(businessId, who.trim());
  if (byId) return { contact: byId };
  const found = searchAddressBook(businessId, who, undefined, 6);
  const exact = found.filter((c) => c.name.toLowerCase() === who.trim().toLowerCase());
  if (exact.length === 1 || found.length === 1) return { contact: exact[0] ?? found[0] };
  if (!found.length) return { error: `Nobody in the address book matches "${who}". Use search_contacts.` };
  return { error: `More than one person matches "${who}"; pass the id:\n${found.map((c) => `${describeContact(c)}\n  id: ${c.id}`).join("\n")}` };
}

function line(i: TimelineItem) {
  const day = i.at.slice(0, 16).replace("T", " ");
  const who = i.who ? ` ${i.who}` : "";
  switch (i.kind) {
    case "whatsapp":
      return `${day} WhatsApp ${i.direction === "in" ? "from them" : `to them${who ? ` (by${who})` : ""}`}: ${i.title || "(media)"}`;
    case "watch":
      return `${day} WhatsApp ${i.direction === "in" ? "reply" : `sent by${who || " the team"}`} — ${i.title}${i.status ? ` [${i.status}]` : ""}`;
    case "task":
      return `${day} Task${who ? ` for${who}` : ""}: ${i.title} [${i.status}]`;
    case "deliverable":
      return `${day} Mentioned in work: ${i.title} [${i.status}]`;
    case "link":
      return `${day} Linked ${i.direction === "out" ? "to" : "from"} ${i.linkType}: ${i.title}`;
    case "interaction":
      return `${day} ${i.interaction}${who ? ` (by${who})` : i.by === "owner" ? " (by the owner)" : ""}: ${i.title}`;
    case "follow_up":
      return `${day} Follow-up ${i.followUp}${i.followUpAt ? ` for ${i.followUpAt.slice(0, 10)}` : ""}${i.title ? `: ${i.title}` : ""}${who ? ` (by${who})` : ""}`;
    case "change":
      return `${day} Contact ${i.change === "merge" ? "merged with duplicates" : `${i.change}d`}${who ? ` by${who}` : ""}`;
  }
}

/** "2026-11-02", "2026-11-02T09:00", or an ISO time → a Date (a bare day means 09:00 local). */
function parseWhen(s: string) {
  const v = s.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T09:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function contactTools(ctx: ContactToolsContext) {
  const { businessId, teammate, taskId } = ctx;
  const by = `teammate:${teammate.id}`;
  const ev = (type: string, message: string, data?: Record<string, unknown>) => logEvent({ businessId, teammateId: teammate.id, taskId, type, message, data });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input shapes
  const tools: SdkMcpToolDefinition<any>[] = [
    tool(
      "contact_timeline",
      "See everything with one person in the address book, newest first: WhatsApp messages, the team's tasks and work that mention them, linked docs and files, logged calls/meetings/notes, and follow-ups. Use it before contacting someone, to know where things stand.",
      {
        contact: z.string().describe('The contact\'s id (from search_contacts), or their name, e.g. "Bu Rina"'),
        limit: z.number().int().min(1).max(100).optional().describe("How many entries (default 30)"),
      },
      async (a) => {
        if (!canAgent(businessId, "contacts", "read")) return fail(READ_OFF);
        const r = resolve(businessId, a.contact);
        if ("error" in r) return fail(r.error);
        const items = contactTimeline(businessId, r.contact.id, a.limit ?? 30);
        const head = `${describeContact(r.contact)}\n  id: ${r.contact.id}`;
        return ok(items.length ? `${head}\n\nTimeline (newest first):\n${items.map(line).join("\n")}` : `${head}\n\nNothing in the timeline yet.`);
      },
    ),

    tool(
      "log_interaction",
      "Record a call, meeting, note or message you had with (or about) a person, so the owner and the team see it in their timeline. Write what happened and what was agreed, in the business's language.",
      {
        contact: z.string().describe("The contact's id, or their name"),
        kind: z.enum(INTERACTION_KINDS as [InteractionKind, ...InteractionKind[]]),
        text: z.string().describe("What happened, e.g. \"Asked for 50 pcs by Friday; sent the price list\""),
      },
      async (a) => {
        if (!canAgent(businessId, "contacts", "suggest")) return fail(WRITE_OFF);
        const r = resolve(businessId, a.contact);
        if ("error" in r) return fail(r.error);
        const done = logInteraction(businessId, r.contact.id, a.kind, a.text, by);
        if ("error" in done) return fail(done.error ?? "Couldn't log it.");
        ev("contact_interaction", `${teammate.name} logged a ${a.kind} with ${r.contact.name}`, { contactId: r.contact.id });
        return ok(`Logged the ${a.kind} in ${r.contact.name}'s timeline.`);
      },
    ),

    tool(
      "set_follow_up",
      "Set when to get back to a person and why (the owner sees due follow-ups on Home and in Contacts), clear it, or mark it done once it happened.",
      {
        contact: z.string().describe("The contact's id, or their name"),
        date: z.string().optional().describe('When, e.g. "2026-11-02" or "2026-11-02T14:00". Leave out with done or clear.'),
        note: z.string().optional().describe("What for, e.g. \"Check if the sample arrived\""),
        done: z.boolean().optional().describe("The follow-up happened: clear it and keep it in the timeline"),
        clear: z.boolean().optional().describe("Remove the follow-up without doing it"),
      },
      async (a) => {
        if (!canAgent(businessId, "contacts", "suggest")) return fail(WRITE_OFF);
        const r = resolve(businessId, a.contact);
        if ("error" in r) return fail(r.error);
        const name = r.contact.name;
        if (a.done) {
          const x = completeFollowUp(businessId, r.contact.id, by);
          if ("error" in x) return fail(x.error ?? "Couldn't mark it done.");
          ev("contact_follow_up", `${teammate.name} marked the follow-up with ${name} done`, { contactId: r.contact.id });
          return ok(`Marked the follow-up with ${name} done.`);
        }
        if (a.clear) {
          const x = setFollowUp(businessId, r.contact.id, null, "", by);
          if ("error" in x) return fail(x.error ?? "Couldn't clear it.");
          return ok(`Cleared the follow-up with ${name}.`);
        }
        if (!a.date) return fail("Say when (date), or pass done or clear.");
        const at = parseWhen(a.date);
        if (!at) return fail(`"${a.date}" isn't a date. Use YYYY-MM-DD.`);
        const x = setFollowUp(businessId, r.contact.id, at, a.note ?? "", by);
        if ("error" in x) return fail(x.error ?? "Couldn't set it.");
        ev("contact_follow_up", `${teammate.name} set a follow-up with ${name} for ${at.toISOString().slice(0, 10)}`, { contactId: r.contact.id });
        return ok(`Follow-up with ${name} set for ${at.toISOString().slice(0, 16).replace("T", " ")}${a.note?.trim() ? `: ${a.note.trim()}` : ""}.`);
      },
    ),

    tool(
      "list_segment",
      "The owner's saved contact segments (e.g. \"VIP resellers\", \"Due this week\"). Without a segment, lists them; with one, lists the people in it.",
      { segment: z.string().optional().describe("The segment's name or id") },
      async (a) => {
        if (!canAgent(businessId, "contacts", "read")) return fail(READ_OFF);
        if (!a.segment?.trim()) {
          const all = listSegments(businessId);
          if (!all.length) return ok("The owner hasn't saved any segments. Use search_contacts.");
          return ok(
            all
              .map((s) => {
                const rules = [s.kind && `kind ${s.kind}`, s.tags.length && `tags ${s.tags.map((t) => `#${t}`).join(" ")}`, s.text && `words "${s.text}"`, s.followUp !== "any" && `follow-up ${s.followUp}`].filter(Boolean);
                return `- ${s.name}${rules.length ? ` (${rules.join(", ")})` : ""}`;
              })
              .join("\n"),
          );
        }
        const s = getSegment(businessId, a.segment);
        if (!s) return fail(`No segment called "${a.segment}". Call list_segment without a segment to see them.`);
        const people = segmentContacts(businessId, s);
        if (!people.length) return ok(`Nobody is in "${s.name}" right now.`);
        return ok(`${people.length} in "${s.name}"${people.length > 80 ? " (first 80)" : ""}:\n${people.slice(0, 80).map((c) => `${describeContact(c)}\n  id: ${c.id}`).join("\n")}`);
      },
    ),
  ];
  return tools;
}
