import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Deliverable, DeliverableStatus } from "@/db/schema";
import { listContacts } from "@/lib/contacts";
import { listPageHeads } from "@/lib/context";
import { normalizeFolder, renameFolderPath, renameIsCircular } from "@/lib/docs-folders";
import { DOC_STATUSES, deliverableAuthor, type DocItem } from "@/lib/docs-list";
import { diffMentions, parseMentions, type MentionRef } from "@/lib/docs-mentions";
import { logEvent } from "@/lib/events";
import { addLink, describeRef, linksFrom, removeLink } from "@/lib/links";
import { isServablePath } from "@/lib/media";
import { recordHistory } from "@/lib/object-history";
import { dataDir } from "@/lib/paths";
import { matchIds } from "@/lib/search";
import { softDelete } from "@/lib/trash";
import { syncDeliverableFile } from "@/lib/workfiles";

/**
 * Docs (src/app/b/[id]/docs): the owner's view over saved work (`deliverables`) and the
 * pages the team reads (`context_pages`). Context pages are edited in Context; this file
 * writes deliverables: saving (with object_history and @mention links), folders, bulk
 * status and Trash.
 */

const t = schema.deliverables;
const live = (businessId: string) => and(eq(t.businessId, businessId), isNull(t.deletedAt));

/** The latest deliverables and every live Context page, as list rows (no text), newest first. */
export function listDocItems(businessId: string, limit = 500): DocItem[] {
  const work = db
    .select({ id: t.id, title: t.title, kind: t.kind, status: t.status, teammateId: t.teammateId, createdBy: t.createdBy, folder: t.folder, createdAt: t.createdAt })
    .from(t)
    .where(live(businessId))
    .orderBy(desc(t.createdAt))
    .limit(limit)
    .all()
    .map(
      (d): DocItem => ({ source: "deliverable", id: d.id, title: d.title, kind: d.kind, status: d.status, by: deliverableAuthor(d), folder: d.folder, at: d.createdAt.getTime() }),
    );
  const pages = listPageHeads(businessId)
    .filter((p) => p.kind !== "database")
    .map(
      (p): DocItem => ({ source: "context", id: p.id, title: p.title, kind: p.kind, status: "context", by: p.createdBy, folder: null, at: (p.updatedAt ?? p.createdAt).getTime() }),
    );
  return [...work, ...pages].sort((a, b) => b.at - a.at);
}

/**
 * Text search over both tables: "deliverable:<id>" / "context:<id>" keys of the docs whose
 * title or text match every word. Words too short for the index fall back to the titles.
 * Null for an empty query.
 */
export function searchDocKeys(businessId: string, q: string): Set<string> | null {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const work = matchIds("deliverables", businessId, words, { all: true, limit: 500 });
  const pages = matchIds("context_pages", businessId, words, { all: true, limit: 500 });
  if (work && pages) return new Set([...work.map((id) => `deliverable:${id}`), ...pages.map((id) => `context:${id}`)]);
  const pat = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const title = (col: Parameters<typeof like>[0]) => sql`${col} like ${pat} escape '\\'`;
  const w = db.select({ id: t.id }).from(t).where(and(live(businessId), title(t.title))).all();
  const c = schema.contextPages;
  const p = db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.businessId, businessId), isNull(c.deletedAt), title(c.title)))
    .all();
  return new Set([...w.map((r) => `deliverable:${r.id}`), ...p.map((r) => `context:${r.id}`)]);
}

/** Everything "@" can mention in the editor: contacts, library files, deliverables and Context pages. */
export type MentionCandidate = MentionRef & { label: string; hint?: string };

export function mentionCandidates(businessId: string, library: { path: string; name: string }[]): MentionCandidate[] {
  const contacts = listContacts(businessId).map((c): MentionCandidate => ({ type: "contact", id: c.id, label: c.name, hint: c.company ?? c.phone ?? undefined }));
  const assets = library.map((a): MentionCandidate => ({ type: "asset", id: a.path, label: a.name }));
  const work = db
    .select({ id: t.id, title: t.title })
    .from(t)
    .where(live(businessId))
    .orderBy(desc(t.createdAt))
    .limit(500)
    .all()
    .map((d): MentionCandidate => ({ type: "deliverable", id: d.id, label: d.title }));
  const pages = listPageHeads(businessId).map((p): MentionCandidate => ({ type: "doc", id: p.id, label: p.title }));
  return [...contacts, ...work, ...pages, ...assets];
}

/**
 * Keep a deliverable's links in step with the @mentions in its text: link what's newly
 * mentioned, unlink what was mentioned before and isn't now (only links the owner made;
 * a link a teammate made, or one made by hand, stays). Mentions of objects that are gone
 * or in Trash aren't linked.
 */
export function syncMentionLinks(businessId: string, deliverableId: string, before: string, after: string, by = "owner") {
  const from = { type: "deliverable" as const, id: deliverableId };
  const { add, remove } = diffMentions(parseMentions(before), parseMentions(after));
  for (const r of add) {
    const info = describeRef(businessId, r);
    if (info && !info.deleted) addLink(businessId, from, r, by);
  }
  if (remove.length) {
    const mine = new Set(
      linksFrom(businessId, from)
        .filter((l) => l.createdBy === by)
        .map((l) => `${l.type}:${l.id}`),
    );
    for (const r of remove) if (mine.has(`${r.type}:${r.id}`)) removeLink(businessId, from, r);
  }
  return { added: add.length, removed: remove.length };
}

/** A deliverable's row for object_history, without its (large) earlier versions. */
const snapshotOf = (d: Deliverable) => ({ ...d, versions: undefined });

function readDoc(businessId: string, id: string) {
  return db
    .select()
    .from(t)
    .where(and(eq(t.id, id), live(businessId)))
    .get();
}

export type DocInput = {
  id?: string;
  title: string;
  kind: string;
  channel: string;
  content: string;
  status: DeliverableStatus;
  attachments: string[];
  folder?: string | null;
};

/**
 * Write or edit a doc as the owner: the owner's own notes and briefs, or the team's saved
 * work. Records object_history, keeps @mention links in step and mirrors the doc to
 * work/*.md (teammates find docs with list_deliverables).
 */
export function saveDocument(businessId: string, doc: DocInput, by = "owner"): { id: string } | { error: string } {
  const title = doc.title.trim().slice(0, 200);
  if (!title) return { error: "Give the doc a title." };
  if (!DOC_STATUSES.includes(doc.status)) return { error: "Unknown status" };
  const values = {
    title,
    kind: doc.kind.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) || "note",
    channel: doc.channel.trim() || null,
    content: doc.content,
    status: doc.status,
    attachments: doc.attachments.filter((p) => isServablePath(p) && fs.existsSync(path.join(dataDir(), p))),
    ...(doc.folder !== undefined ? { folder: normalizeFolder(doc.folder) } : {}),
  };
  let row: Deliverable | undefined;
  let before = "";
  if (doc.id) {
    const old = readDoc(businessId, doc.id);
    if (!old) return { error: "Doc not found" };
    before = old.content;
    row = db
      .update(t)
      .set({ ...values, updatedBy: by })
      .where(and(eq(t.id, doc.id), live(businessId)))
      .returning()
      .get();
    if (!row) return { error: "Doc not found" };
    recordHistory({ businessId, type: "deliverable", id: row.id, snapshot: snapshotOf(row), action: "update", by });
  } else {
    row = db
      .insert(t)
      .values({ businessId, ...values, createdBy: by, updatedBy: by })
      .returning()
      .get();
    recordHistory({ businessId, type: "deliverable", id: row.id, snapshot: snapshotOf(row), action: "create", by });
    logEvent({ businessId, type: "doc_written", message: `You wrote "${title}" in Docs`, data: { deliverableId: row.id } });
  }
  syncMentionLinks(businessId, row.id, before, row.content, by);
  syncDeliverableFile(row.id);
  return { id: row.id };
}

/** Change some live docs and record each change; returns how many changed. */
function updateEach(businessId: string, ids: string[], patch: (d: Deliverable) => Partial<Deliverable> | null, by: string) {
  if (!ids.length) return 0;
  const rows = db
    .select()
    .from(t)
    .where(and(live(businessId), inArray(t.id, ids)))
    .all();
  let n = 0;
  for (const d of rows) {
    const p = patch(d);
    if (!p) continue;
    const row = db
      .update(t)
      .set({ ...p, updatedBy: by })
      .where(eq(t.id, d.id))
      .returning()
      .get();
    recordHistory({ businessId, type: "deliverable", id: d.id, snapshot: snapshotOf(row), action: "update", by });
    n++;
  }
  return n;
}

/** Move docs into a folder (null: the top level). */
export function moveDocs(businessId: string, ids: string[], folder: string | null, by = "owner") {
  const to = normalizeFolder(folder);
  return updateEach(businessId, ids, (d) => (d.folder === to ? null : { folder: to }), by);
}

/** Rename a folder: every doc in it or under it moves along. */
export function renameFolder(businessId: string, from: string, to: string | null, by = "owner"): { moved: number } | { error: string } {
  const src = normalizeFolder(from);
  const dst = normalizeFolder(to);
  if (!src) return { error: "Pick a folder." };
  if (renameIsCircular(src, dst)) return { error: "A folder can't go inside itself." };
  const ids = db
    .select({ id: t.id })
    .from(t)
    .where(and(live(businessId), or(eq(t.folder, src), sql`${t.folder} like ${`${src.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`} escape '\\'`)))
    .all()
    .map((r) => r.id);
  const moved = updateEach(
    businessId,
    ids,
    (d) => {
      const next = renameFolderPath(d.folder, src, dst);
      return next === d.folder ? null : { folder: next };
    },
    by,
  );
  return { moved };
}

export function setDocsStatus(businessId: string, ids: string[], status: DeliverableStatus, by = "owner") {
  if (!DOC_STATUSES.includes(status)) return 0;
  return updateEach(businessId, ids, (d) => (d.status === status ? null : { status }), by);
}

/** Move docs to Trash (their work/*.md mirrors go too); returns how many went. */
export function trashDocs(businessId: string, ids: string[], by = "owner") {
  return ids.filter((id) => softDelete(businessId, "deliverable", id, by)).length;
}

/** A live doc for export, or undefined. */
export function exportableDoc(businessId: string, id: string) {
  return readDoc(businessId, id);
}
