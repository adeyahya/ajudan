/**
 * Workspace tools for teammates (docs/HYBRID-PLAN.md, phase 3): one search over docs,
 * deliverables, the library and contacts, creating docs, links between objects and tags.
 * Part of the "biz" MCP server (worker/tools.ts). Access follows src/lib/agent-access.ts
 * via src/lib/workspace-access.ts, and every change goes into object_history with
 * by = "teammate:<id>".
 */
import fs from "node:fs";
import path from "node:path";
import { tool, type SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { Contact, ObjectType } from "@/db/schema";
import { canAgent } from "@/lib/agent-access";
import { cleanTags, isLibraryPath } from "@/lib/assets";
import { listContacts } from "@/lib/contacts";
import { logEvent } from "@/lib/events";
import { normalizePhone } from "@/lib/humans";
import { addLink, describeRef, OBJECT_TYPES, removeLink, type ObjectRef } from "@/lib/links";
import { linkIntoWorkspace } from "@/lib/media";
import { NO_LABELS, recordHistory } from "@/lib/object-history";
import { dataDir } from "@/lib/paths";
import { isSupervised } from "@/lib/supervision";
import { canChange, canCreate, collectionOf, teammateBy } from "@/lib/workspace-access";
import { searchWorkspace, WORKSPACE_TYPES, type WorkspaceHit, type WorkspaceType } from "@/lib/workspace-search";
import { syncDeliverableFile } from "@/lib/workfiles";
import type { BizContext } from "./tools";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/** "deliverable:abc", "asset:media/x.jpg", "contact:…", "doc:…", "task:…"; a bare "media/…" is an asset. */
export function parseRef(s: string): ObjectRef | null {
  const v = s.trim().replace(/^\.?\//, "");
  if (/^media\//.test(v)) return { type: "asset", id: v };
  const m = /^([a-z]+):(.+)$/.exec(v);
  if (!m || !(OBJECT_TYPES as string[]).includes(m[1])) return null;
  const id = m[2].trim().replace(/^\.?\//, "");
  return id ? { type: m[1] as ObjectType, id } : null;
}

export const refString = (r: ObjectRef) => `${r.type}:${r.id}`;

/** The object is there and not in Trash (a library file: on disk). */
function liveRef(businessId: string, r: ObjectRef) {
  if (r.type === "asset" && (!isLibraryPath(r.id) || !fs.existsSync(path.join(dataDir(), r.id)))) return null;
  const info = describeRef(businessId, r);
  return info && !info.deleted ? info : null;
}

/**
 * The contact save_contact would change: the same match as upsertContact in
 * src/lib/contacts.ts (by id, then phone, then exact name). Undefined: it would add someone.
 */
export function contactToChange(businessId: string, input: { id?: string; phone?: string; name?: string }): Contact | undefined {
  const all = listContacts(businessId);
  if (input.id) return all.find((c) => c.id === input.id);
  const language = db.select({ l: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.l ?? "en";
  const phone = input.phone?.trim() ? normalizePhone(input.phone, language) : null;
  return (phone && all.find((c) => c.phone === phone)) || (input.name?.trim() && all.find((c) => c.name.toLowerCase() === input.name!.trim().toLowerCase())) || undefined;
}

/** "Marketing / Q3/" → "Marketing/Q3"; empty → null. */
export function cleanFolder(folder?: string | null) {
  const parts = (folder ?? "")
    .split("/")
    .map((p) => p.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 6);
  return parts.length ? parts.join("/") : null;
}

const TYPE_LABEL: Record<WorkspaceType, string> = { doc: "page", deliverable: "doc", asset: "file", contact: "contact" };

function byLabel(createdBy: string, teammateId: string) {
  if (createdBy === teammateBy(teammateId)) return "by you";
  if (createdBy.startsWith("teammate:")) return "by a teammate";
  return createdBy === "system" ? "by Ajudan" : "by the owner";
}

/** One result line: "- [file] ★ "Sakura close-up" (asset:media/…, by the owner): snippet". */
export function describeHit(h: WorkspaceHit, teammateId: string) {
  const star = h.starred ? "★ " : "";
  const extra = [h.kind && h.type !== "contact" ? h.kind : "", h.folder ? `folder ${h.folder}` : "", byLabel(h.createdBy, teammateId)].filter(Boolean).join(", ");
  return `- [${TYPE_LABEL[h.type]}] ${star}"${h.title}" (${refString(h)}; ${extra})${h.snippet ? `: ${h.snippet.slice(0, 220)}` : ""}`;
}

const COLLECTION_OF: Record<WorkspaceType, "docs" | "library" | "contacts"> = { doc: "docs", deliverable: "docs", asset: "library", contact: "contacts" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input shapes
export function workspaceTools(ctx: BizContext): SdkMcpToolDefinition<any>[] {
  const { businessId, teammate, taskId } = ctx;
  const by = teammateBy(teammate.id);
  const ev = (type: string, message: string, data?: Record<string, unknown>) => logEvent({ businessId, teammateId: teammate.id, taskId, type, message, data });
  const readable = (types: WorkspaceType[]) => types.filter((t) => canAgent(businessId, COLLECTION_OF[t], "read"));
  const showHits = (hits: WorkspaceHit[]) => {
    const files = hits.filter((h) => h.type === "asset").map((h) => h.id);
    if (files.length) linkIntoWorkspace(files, ctx.cwd);
    return hits.map((h) => describeHit(h, teammate.id)).join("\n");
  };

  return [
    tool(
      "search_workspace",
      "Search everything the business keeps in one go: the owner's Context pages, docs and saved work (deliverables), the media library and the address book. Results are typed and best first; what the owner curated (★ starred files, labeled files, always-read pages, contacts with notes) ranks higher. Each result has a ref (e.g. deliverable:<id>, asset:media/…, contact:<id>, doc:<id>) for read_deliverable, read_page, link_objects and tag_objects. Library files become readable in your folder.",
      {
        query: z.string().describe('Words to look for, e.g. "payday promo", "Bu Rina", "washi"'),
        types: z.array(z.enum(["doc", "deliverable", "asset", "contact"])).optional().describe("Only these: doc (Context pages), deliverable (docs and work), asset (library files), contact"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 15"),
      },
      async (a) => {
        const types = readable(a.types?.length ? a.types : WORKSPACE_TYPES);
        const hits = searchWorkspace(businessId, a.query, { types, limit: a.limit ?? 15, teammateId: teammate.id });
        if (!hits.length) return ok(`Nothing in the workspace matches "${a.query}". Try other or fewer words (2+ letters each).`);
        return ok(showHits(hits));
      },
    ),

    tool(
      "search_docs",
      "Search the owner's Context pages and the business's docs and saved work (deliverables) for a topic: best matches first, with a snippet. Read one in full with read_page (doc:…) or read_deliverable (deliverable:…).",
      { query: z.string().describe('e.g. "refund policy", "Q3 content plan"') },
      async (a) => {
        if (!canAgent(businessId, "docs", "read")) return fail("The owner hasn't shared docs with the team.");
        const hits = searchWorkspace(businessId, a.query, { types: ["doc", "deliverable"], limit: 12, teammateId: teammate.id });
        return ok(hits.length ? showHits(hits) : `No page or doc matches "${a.query}".`);
      },
    ),

    tool(
      "search_media",
      "Find files in the media library by what the owner wrote on them (title, note, #tags, album) and by file name. ★ starred and labeled files first. Found files become readable in your folder at the same media/… path; inspect_media and extract_frames tell you more. list_media lists by album, tag or star instead.",
      {
        query: z.string().describe('e.g. "unboxing", "sakura washi", "logo"'),
        kind: z.enum(["video", "image", "audio", "file"]).optional(),
      },
      async (a) => {
        if (!canAgent(businessId, "library", "read")) return fail("The owner hasn't shared the media library with the team.");
        const hits = searchWorkspace(businessId, a.query, { types: ["asset"], mediaKind: a.kind, limit: 25 });
        return ok(hits.length ? showHits(hits) : `No library file matches "${a.query}". list_media shows everything.`);
      },
    ),

    tool(
      "create_doc",
      "Write a new doc in the business's Docs (a brief, plan, SOP, notes, a reworked version of someone's doc), optionally in a folder like \"Marketing/Q3\". It's yours: you can revise it later with update_deliverable. For finished work the owner will post or use (posts, emails, reports), save_deliverable is the usual way. Returns the doc's ref.",
      {
        title: z.string().describe("Short descriptive title"),
        content: z.string().describe("The full doc, as markdown"),
        folder: z.string().optional().describe('A "/"-separated folder, e.g. "Marketing/Q3"'),
        kind: z.string().optional().describe('Type of doc, e.g. "doc" (default), "brief", "plan", "sop", "notes"'),
      },
      async (a) => {
        const can = canCreate(businessId, "docs");
        if (!can.ok) return fail(can.reason);
        if (!a.title.trim() || !a.content.trim()) return fail("A doc needs a title and content.");
        const row = db
          .insert(schema.deliverables)
          .values({
            businessId,
            teammateId: teammate.id,
            taskId,
            kind: a.kind?.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) || "doc",
            title: a.title.trim().slice(0, 200),
            content: a.content,
            status: "draft",
            folder: cleanFolder(a.folder),
            createdBy: by,
            updatedBy: by,
          })
          .returning()
          .get();
        syncDeliverableFile(row.id);
        recordHistory({ businessId, type: "deliverable", id: row.id, snapshot: row, action: "create", by });
        ev("deliverable_saved", `${teammate.name} wrote "${row.title}" in Docs`, { deliverableId: row.id, kind: row.kind });
        return ok(`Created "${row.title}"${row.folder ? ` in ${row.folder}` : ""} (ref deliverable:${row.id}, deliverable_id ${row.id}).`);
      },
    ),

    tool(
      "link_objects",
      "Link two things in the workspace so each shows the other (backlinks): a doc to the contact it's about, a library file to the post that uses it, your new version of a doc to the original. Refs as search_workspace shows them: deliverable:<id>, doc:<id>, asset:media/…, contact:<id>, task:<id>.",
      {
        from: z.string().describe('e.g. "deliverable:3f2a…"'),
        to: z.string().describe('e.g. "contact:9b1c…" or "asset:media/2026-10-22-unboxing-a1b2c3.mp4"'),
      },
      async (a) => {
        const from = parseRef(a.from);
        const to = parseRef(a.to);
        if (!from || !to) return fail(`Use refs like deliverable:<id>, doc:<id>, asset:media/…, contact:<id> or task:<id> (got "${!from ? a.from : a.to}").`);
        const f = liveRef(businessId, from);
        const t = liveRef(businessId, to);
        if (!f || !t) return fail(`${!f ? a.from : a.to} doesn't exist (or is in Trash). search_workspace finds refs.`);
        const area = collectionOf(from.type) ?? collectionOf(to.type);
        if (area) {
          const can = canCreate(businessId, area);
          if (!can.ok) return fail(can.reason);
        }
        const link = addLink(businessId, from, to, by);
        if (!link) return fail("An object can't link to itself.");
        ev("objects_linked", `${teammate.name} linked "${f.title}" to "${t.title}"`, { from: refString(from), to: refString(to) });
        return ok(`Linked "${f.title}" → "${t.title}".`);
      },
    ),

    tool(
      "unlink_objects",
      "Remove a link between two workspace objects (either direction). You can remove links you made; links the owner made need the owner's write access.",
      { from: z.string(), to: z.string() },
      async (a) => {
        const from = parseRef(a.from);
        const to = parseRef(a.to);
        if (!from || !to) return fail("Use refs like deliverable:<id>, doc:<id>, asset:media/…, contact:<id> or task:<id>.");
        const find = (x: ObjectRef, y: ObjectRef) =>
          db
            .select()
            .from(schema.links)
            .where(and(eq(schema.links.businessId, businessId), eq(schema.links.fromType, x.type), eq(schema.links.fromId, x.id), eq(schema.links.toType, y.type), eq(schema.links.toId, y.id)))
            .get();
        const link = find(from, to) ?? find(to, from);
        if (!link) return ok("They aren't linked.");
        const linkFrom = { type: link.fromType, id: link.fromId };
        const linkTo = { type: link.toType, id: link.toId };
        if (link.createdBy !== by) {
          const area = collectionOf(linkFrom.type) ?? collectionOf(linkTo.type);
          const can = area ? canChange(businessId, area, link.createdBy) : { ok: link.createdBy.startsWith("teammate:"), reason: "The owner made that link.", suggest: true };
          if (!can.ok) return fail(`${can.reason} Leave the link and mention it in your summary.`);
        }
        removeLink(businessId, linkFrom, linkTo);
        ev("objects_unlinked", `${teammate.name} removed a link`, { from: refString(linkFrom), to: refString(linkTo) });
        return ok("Link removed.");
      },
    ),

    tool(
      "tag_objects",
      "Add or remove #tags on library files and contacts in one go (e.g. tag every clip of the new product). Tags are lowercase words; add and remove are lists. Only library files (asset:media/… or media/…) and contacts (contact:<id>) have tags.",
      {
        refs: z.array(z.string()).min(1).max(100).describe('e.g. ["asset:media/clip-1.mp4", "contact:9b1c…"]'),
        add: z.array(z.string()).optional().describe('e.g. ["payday", "unboxing"]'),
        remove: z.array(z.string()).optional(),
      },
      async (a) => {
        const add = cleanTags(a.add ?? []);
        const remove = new Set(cleanTags(a.remove ?? []));
        if (!add.length && !remove.size) return fail("Say which tags to add or remove.");
        // Supervised, team changes wait for the owner: organize_media and save_contact go through that.
        if (isSupervised(businessId)) {
          return fail("The owner is supervising the team, so changes wait for their approval: use organize_media(add_tags) for library files or save_contact(tags) for contacts instead.");
        }
        const done: string[] = [];
        const problems: string[] = [];
        let proposal = false;
        const nextTags = (cur: string[]) => cleanTags([...cur.filter((t) => !remove.has(t)), ...add]);
        for (const raw of a.refs) {
          const r = parseRef(raw);
          if (!r || (r.type !== "asset" && r.type !== "contact")) {
            problems.push(`${raw}: only library files and contacts have tags`);
            continue;
          }
          if (r.type === "asset") {
            if (!isLibraryPath(r.id) || !fs.existsSync(path.join(dataDir(), r.id))) {
              problems.push(`${raw}: not in the media library`);
              continue;
            }
            const cur = db.select().from(schema.assets).where(and(eq(schema.assets.path, r.id), eq(schema.assets.businessId, businessId))).get();
            if (cur?.deletedAt) {
              problems.push(`${raw}: in Trash`);
              continue;
            }
            const can = canChange(businessId, "library", cur?.createdBy ?? "owner");
            if (!can.ok) {
              proposal ||= can.suggest;
              problems.push(`${raw}: ${can.reason}`);
              continue;
            }
            const tags = nextTags(cur?.tags ?? []);
            if (cur) {
              db.update(schema.assets).set({ tags, updatedBy: by }).where(eq(schema.assets.path, r.id)).run();
              recordHistory({ businessId, type: "asset", id: r.id, snapshot: { ...cur, tags, updatedBy: by }, before: cur, action: "update", by });
            } else {
              // The file is the owner's upload: the new labels row stays theirs, changed by this teammate.
              const row = db.insert(schema.assets).values({ path: r.id, businessId, tags, updatedBy: by }).returning().get();
              // Undo clears the labels again rather than trashing the owner's file.
              recordHistory({ businessId, type: "asset", id: r.id, snapshot: row, before: NO_LABELS, action: "update", by });
            }
            done.push(`${path.posix.basename(r.id)}: ${tags.map((t) => `#${t}`).join(" ") || "no tags"}`);
          } else {
            const cur = db.select().from(schema.contacts).where(and(eq(schema.contacts.id, r.id), eq(schema.contacts.businessId, businessId), isNull(schema.contacts.deletedAt))).get();
            if (!cur) {
              problems.push(`${raw}: no such contact`);
              continue;
            }
            const can = canChange(businessId, "contacts", cur.createdBy);
            if (!can.ok) {
              proposal ||= can.suggest;
              problems.push(`${cur.name}: ${can.reason}`);
              continue;
            }
            const tags = nextTags(cur.tags);
            db.update(schema.contacts).set({ tags, updatedBy: by }).where(eq(schema.contacts.id, cur.id)).run();
            recordHistory({ businessId, type: "contact", id: cur.id, snapshot: { ...cur, tags, updatedBy: by }, before: cur, action: "update", by });
            done.push(`${cur.name}: ${tags.map((t) => `#${t}`).join(" ") || "no tags"}`);
          }
        }
        if (done.length) ev("objects_tagged", `${teammate.name} tagged ${done.length} item${done.length === 1 ? "" : "s"}`, { refs: a.refs.slice(0, 20) });
        const text = [
          done.length ? `Tagged:\n${done.map((d) => `- ${d}`).join("\n")}` : "",
          problems.length ? `Not changed:\n${problems.map((p) => `- ${p}`).join("\n")}` : "",
          proposal ? "Tell the owner in your summary which tags you'd suggest for those; they decide." : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        return done.length ? ok(text) : fail(text);
      },
    ),
  ];
}
