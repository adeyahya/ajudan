import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, getTableColumns, gte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ContextPage, ContextSection, ReaderMode, SuggestionKind, Teammate } from "@/db/schema";
import { applySuggestion, budgetPages, DEFAULT_ICONS, defaultReaderMode, forAgents, normalizeMarkdown, readerMode, SECTIONS } from "@/lib/context-text";
import { logEvent } from "@/lib/events";
import { t } from "@/lib/i18n";
import { teammatesRoot } from "@/lib/paths";
import { renderProfileMarkdown } from "@/lib/profile-markdown";
import { canTeamEdit } from "@/lib/team-edits";
import type { BusinessProfile } from "@/lib/types";

/**
 * The Context workspace: pages about the business that the team reads (Notion-style,
 * edited on /b/[id]/context). Each page reaches a teammate "always" (in its prompt),
 * "when needed" (listed by title; read_page / search_context fetch it) or "never".
 * Teammates change pages with suggest_page_edit: the owner accepts or rejects, unless
 * they let the team edit pages directly (src/lib/team-edits.ts; applyPageEdit).
 *
 * Ajudan keeps a few pages itself (by `key`): "about" (seeded from the business profile,
 * written to teammates' BUSINESS.md), "learned" (the owner's feedback, written to
 * teammates/TEAM.md; src/lib/feedback.ts appends to it), "products", "policies" and the
 * "contacts" database (the address book, src/lib/contacts.ts).
 */

export * from "@/lib/context-text";

// ---- pages ----

const now = () => new Date();

export function listPages(businessId: string) {
  return db.select().from(schema.contextPages).where(eq(schema.contextPages.businessId, businessId)).orderBy(asc(schema.contextPages.sortOrder), asc(schema.contextPages.createdAt)).all();
}

// Every column but the page's content (body, editor blocks): for trees, titles and lookups.
const headColumns = Object.fromEntries(Object.entries(getTableColumns(schema.contextPages)).filter(([k]) => k !== "body" && k !== "blocks")) as Omit<
  ReturnType<typeof getTableColumns<typeof schema.contextPages>>,
  "body" | "blocks"
>;
export type PageHead = Omit<ContextPage, "body" | "blocks">;

/** listPages without the content, which can be large: for trees, title lookups and counts. */
export function listPageHeads(businessId: string): PageHead[] {
  return db.select(headColumns).from(schema.contextPages).where(eq(schema.contextPages.businessId, businessId)).orderBy(asc(schema.contextPages.sortOrder), asc(schema.contextPages.createdAt)).all();
}

export function getPage(businessId: string, id: string) {
  return db.select().from(schema.contextPages).where(and(eq(schema.contextPages.id, id), eq(schema.contextPages.businessId, businessId))).get();
}

export function pageByKey(businessId: string, key: string) {
  return db.select().from(schema.contextPages).where(and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.key, key))).get();
}

/** A page by id, exact title, or the closest title (case-insensitive, then contains). */
export function findPage(businessId: string, ref: string) {
  const pages = listPageHeads(businessId);
  const r = ref.trim().replace(/^["“@]|["”]$/g, "").toLowerCase();
  const head =
    pages.find((p) => p.id === ref.trim()) ??
    pages.find((p) => p.title.toLowerCase() === r) ??
    pages.find((p) => p.title.toLowerCase().includes(r)) ??
    pages.find((p) => r.includes(p.title.toLowerCase()));
  return head && getPage(businessId, head.id);
}

/**
 * Create Ajudan's own pages if they're missing: the About page from the profile, what
 * the team learned (from the old teammates/TEAM.md), products, rules & policies, and the
 * contacts database. Safe to call often (on opening the workspace, before each run).
 */
export function ensureContextWorkspace(businessId: string) {
  const biz = db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!biz) return;
  const have = new Set(
    db
      .select({ key: schema.contextPages.key })
      .from(schema.contextPages)
      .where(eq(schema.contextPages.businessId, businessId))
      .all()
      .map((r) => r.key),
  );
  const lang = biz.language;
  const seed = (key: string, v: { section: ContextSection; title: string; body?: string; kind?: "page" | "database"; source?: string; order: number }) => {
    if (have.has(key)) return;
    db.insert(schema.contextPages)
      .values({ businessId, key, section: v.section, title: v.title, body: v.body ?? "", kind: v.kind ?? "page", source: v.source ?? null, icon: DEFAULT_ICONS[key] ?? null, sortOrder: v.order, createdBy: "system", updatedBy: "system", updatedAt: now() })
      // The web app and the worker may both seed at once: one wins (unique business + key).
      .onConflictDoNothing()
      .run();
    have.add(key);
  };
  if (biz.profile) {
    seed("about", { section: "business", title: t(lang, "context.seed.about", { name: biz.name }), body: aboutBody(biz.profile, lang), order: 0 });
    if (biz.profile.products.length) {
      seed("products", { section: "product", title: t(lang, "context.seed.products"), body: biz.profile.products.map((p) => `- ${p}`).join("\n") + "\n", order: 0 });
    }
  }
  seed("policies", { section: "how_we_work", title: t(lang, "context.seed.policies"), body: t(lang, "context.seed.policiesBody"), order: 0 });
  seed("contacts", { section: "people", title: t(lang, "context.seed.contacts"), kind: "database", source: "contacts", order: 0 });
  if (!have.has("learned")) {
    seed("learned", { section: "team_written", title: t(lang, "context.seed.learned"), body: oldTeamNotes(), order: 0 });
    writeTeamNotesFile(businessId);
  }
}

/** The profile as the About page: the profile's markdown without its title (the page has one). */
function aboutBody(profile: BusinessProfile, language: string) {
  return renderProfileMarkdown(profile, language).replace(/^# .*\n+/, "");
}

/** What the old teammates/TEAM.md held, minus its generated header. */
function oldTeamNotes() {
  const file = path.join(teammatesRoot(), "TEAM.md");
  if (!fs.existsSync(file)) return "";
  return fs
    .readFileSync(file, "utf8")
    .replace(/^# Team notes for .*\n+/, "")
    .replace(/^What the owner told the team about its work:.*\n+/m, "")
    .replace(/^\(A copy of the Context page.*\n+/m, "")
    .trim()
    .concat("\n");
}

/**
 * teammates/TEAM.md is now a copy of the "learned" page (teammates' folders get a copy
 * of it each run, and older prompts and checklists name the file).
 */
export function writeTeamNotesFile(businessId: string) {
  const page = pageByKey(businessId, "learned");
  const biz = db.select({ name: schema.businesses.name }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get();
  if (!page || !biz) return;
  fs.mkdirSync(teammatesRoot(), { recursive: true });
  fs.writeFileSync(
    path.join(teammatesRoot(), "TEAM.md"),
    `# Team notes for ${biz.name}\n\n(A copy of the Context page "${page.title}": the owner's feedback and preferences for the whole team. Edit it in Ajudan → Context.)\n\n${forAgents(page.body).trim()}\n`,
  );
}

/** The About page's text for BUSINESS.md, when the workspace has one. */
export function aboutMarkdown(businessId: string) {
  const page = pageByKey(businessId, "about");
  return page ? `# ${page.title}\n\n${forAgents(page.body).trim()}\n` : null;
}

/**
 * The profile changed (Business page, interview): the About page follows it as long as
 * the owner hasn't edited the page itself; after that the page is the source.
 */
export function refreshAboutPage(businessId: string, profile: BusinessProfile, language: string) {
  const page = pageByKey(businessId, "about");
  if (!page) return ensureContextWorkspace(businessId);
  if (page.updatedBy !== "system") return;
  db.update(schema.contextPages).set({ body: aboutBody(profile, language), blocks: null, updatedAt: now() }).where(eq(schema.contextPages.id, page.id)).run();
}

/** A line of owner feedback for the whole team (src/lib/feedback.ts), at the end of the "learned" page. */
export function appendLearned(businessId: string, line: string) {
  ensureContextWorkspace(businessId);
  const page = pageByKey(businessId, "learned");
  if (!page) return;
  db.update(schema.contextPages)
    .set({ body: `${page.body.trimEnd()}${page.body.trim() ? "\n" : ""}${line}\n`, blocks: null, updatedAt: now() })
    .where(eq(schema.contextPages.id, page.id))
    .run();
  writeTeamNotesFile(businessId);
}

/** Pages under the same parent (or at the top of a section), in tree order. */
function siblings(businessId: string, parentId: string | null, section: ContextSection) {
  const where = parentId
    ? and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.parentId, parentId))
    : and(eq(schema.contextPages.businessId, businessId), isNull(schema.contextPages.parentId), eq(schema.contextPages.section, section));
  return db.select().from(schema.contextPages).where(where).orderBy(asc(schema.contextPages.sortOrder), asc(schema.contextPages.createdAt)).all();
}

export function createPage(
  businessId: string,
  v: { title: string; section: ContextSection; kind?: "page" | "mindmap"; parentId?: string | null; body?: string; icon?: string | null; createdBy?: string },
) {
  // A sub-page lives in its parent's section (the tree shows it under the parent).
  const parent = v.parentId ? getPage(businessId, v.parentId) : undefined;
  const parentId = parent && parent.kind === "page" ? parent.id : null;
  const section = parent && parentId ? parent.section : v.section;
  const last = siblings(businessId, parentId, section).at(-1);
  return db
    .insert(schema.contextPages)
    .values({
      businessId,
      section,
      parentId,
      kind: v.kind ?? "page",
      title: v.title.trim().slice(0, 120) || "Untitled",
      body: v.body ?? "",
      icon: v.icon ?? null,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      createdBy: v.createdBy ?? "owner",
      updatedBy: v.createdBy ?? "owner",
      updatedAt: now(),
    })
    .returning()
    .get();
}

/** A cover must be a file in the business folder's media/ or work/. */
const coverPath = (c: string | null) => (c && /^(media|work)\//.test(c) && !c.split("/").includes("..") ? c : null);

/** The owner's edit from the editor (autosave), a rename, an icon or cover, "still true". */
export function updatePage(
  businessId: string,
  id: string,
  patch: { title?: string; body?: string; blocks?: unknown[] | null; section?: ContextSection; checked?: boolean; icon?: string | null; cover?: string | null },
) {
  const page = getPage(businessId, id);
  if (!page) return undefined;
  // A section change is a move: to the top of that section, sub-pages included.
  if (patch.section && patch.section !== page.section && SECTIONS.includes(patch.section)) {
    movePage(businessId, id, { parentId: null, section: patch.section });
  }
  const set: Partial<ContextPage> = { updatedAt: now(), updatedBy: "owner" };
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 120) || page.title;
  if (patch.body !== undefined) set.body = patch.body.slice(0, 200_000);
  if (patch.blocks !== undefined) set.blocks = patch.blocks;
  if (patch.checked) set.lastCheckedAt = now();
  if (patch.icon !== undefined) set.icon = patch.icon === null ? null : patch.icon.trim().slice(0, 64);
  if (patch.cover !== undefined) set.cover = coverPath(patch.cover);
  const row = db.update(schema.contextPages).set(set).where(eq(schema.contextPages.id, id)).returning().get();
  if (page.key === "learned") writeTeamNotesFile(businessId);
  return row;
}

/** A page and every page under it (ids, the page first). */
function subtreeIds(businessId: string, id: string) {
  const pages = listPageHeads(businessId);
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const p of pages) if (p.parentId === out[i] && !out.includes(p.id)) out.push(p.id);
  return out;
}

/**
 * Move a page in the tree (drag and drop): under `parentId` (null: the top of `section`),
 * at `index` among its new siblings (default: last). Sub-pages come along and take the
 * new section. Refused: a page into itself or one of its sub-pages, and pages under a
 * database. Returns false when nothing moved.
 */
export function movePage(businessId: string, id: string, to: { parentId: string | null; section?: ContextSection; index?: number }) {
  const page = getPage(businessId, id);
  if (!page) return false;
  let section = to.section && SECTIONS.includes(to.section) ? to.section : page.section;
  let parentId: string | null = null;
  if (to.parentId) {
    const parent = getPage(businessId, to.parentId);
    if (!parent || parent.kind !== "page") return false;
    if (subtreeIds(businessId, id).includes(parent.id)) return false;
    parentId = parent.id;
    section = parent.section;
  }
  const list = siblings(businessId, parentId, section).filter((p) => p.id !== id);
  const at = Math.max(0, Math.min(to.index ?? list.length, list.length));
  list.splice(at, 0, page);
  const under = section !== page.section ? subtreeIds(businessId, id).slice(1) : [];
  db.transaction((tx) => {
    list.forEach((p, i) => {
      if (p.id === id) tx.update(schema.contextPages).set({ sortOrder: i + 1, parentId, section }).where(eq(schema.contextPages.id, id)).run();
      else if (p.sortOrder !== i + 1) tx.update(schema.contextPages).set({ sortOrder: i + 1 }).where(eq(schema.contextPages.id, p.id)).run();
    });
    if (under.length) tx.update(schema.contextPages).set({ section }).where(inArray(schema.contextPages.id, under)).run();
  });
  return true;
}

/** Delete a page the owner made (Ajudan's own pages stay; their sub-pages move up). */
export function deletePage(businessId: string, id: string) {
  const page = getPage(businessId, id);
  if (!page || page.key) return false;
  db.update(schema.contextPages).set({ parentId: page.parentId }).where(and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.parentId, id))).run();
  db.delete(schema.contextPages).where(eq(schema.contextPages.id, id)).run();
  return true;
}

// ---- readers ----

export function readerRows(businessId: string) {
  return db
    .select(getTableColumns(schema.contextReaders))
    .from(schema.contextReaders)
    .innerJoin(schema.contextPages, eq(schema.contextPages.id, schema.contextReaders.pageId))
    .where(eq(schema.contextPages.businessId, businessId))
    .all();
}

/** Pages and reader rows, loaded once and passed to pagesFor when it runs per teammate. */
export type LoadedPages = { pages: ContextPage[]; rows: ReturnType<typeof readerRows> };

export function setReaderMode(businessId: string, pageId: string, teammateId: string, mode: ReaderMode) {
  const page = getPage(businessId, pageId);
  const mate = db.select({ id: schema.teammates.id }).from(schema.teammates).where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId))).get();
  if (!page || !mate) return false;
  db.delete(schema.contextReaders).where(and(eq(schema.contextReaders.pageId, pageId), eq(schema.contextReaders.teammateId, teammateId))).run();
  // The default needs no row, so changing the section later changes it too.
  if (mode !== defaultReaderMode(page)) db.insert(schema.contextReaders).values({ pageId, teammateId, mode }).run();
  return true;
}

/** The pages a teammate gets: always (in its prompt) and when needed (by title), never left out. */
export function pagesFor(businessId: string, teammateId: string, loaded?: LoadedPages) {
  const { pages, rows } = loaded ?? { pages: listPages(businessId), rows: readerRows(businessId) };
  const order = (p: ContextPage) => SECTIONS.indexOf(p.section);
  const sorted = [...pages].sort((a, b) => order(a) - order(b) || a.sortOrder - b.sortOrder);
  const mode = (p: ContextPage) => readerMode(p, teammateId, rows);
  return {
    always: sorted.filter((p) => p.kind !== "database" && mode(p) === "always"),
    whenNeeded: sorted.filter((p) => mode(p) === "when_needed" || (p.kind === "database" && mode(p) === "always")),
    never: sorted.filter((p) => mode(p) === "never"),
  };
}

/** A page this teammate may read (not "never"). */
export function readablePage(businessId: string, teammateId: string, ref: string) {
  const page = findPage(businessId, ref);
  if (!page) return { error: `No page "${ref}". Use search_context to find one.` } as const;
  if (readerMode(page, teammateId, readerRows(businessId)) === "never") return { error: `"${page.title}" isn't shared with you.` } as const;
  return { page } as const;
}

/**
 * The context part of a teammate's system prompt: its always-pages (within the budget)
 * and the titles of the rest. Returns what went in, for recordLoads.
 */
export function contextPrompt(businessId: string, teammateId: string, loaded?: LoadedPages) {
  const { always, whenNeeded } = pagesFor(businessId, teammateId, loaded);
  const { text, items } = budgetPages(always);
  const more = whenNeeded.slice(0, 40).map((p) => `- ${p.title}${p.kind === "database" ? " (database)" : p.kind === "mindmap" ? " (mind map)" : ""}`);
  if (!text && !more.length) return { prompt: "", items };
  const prompt = `## Business context (the owner's Context pages)
${text || "(no pages are always shared with you)"}
${more.length ? `\nMore pages, read when the task needs them (read_page, or search_context to find facts):\n${more.join("\n")}${whenNeeded.length > 40 ? `\n- … and ${whenNeeded.length - 40} more` : ""}\n` : ""}
When you use a fact from a page, cite it by title, e.g. (from "${always[0]?.title ?? whenNeeded[0]?.title ?? "Rules & policies"}"). Pages are the owner's; never contradict them. If you learn something durable that's missing or out of date (a new price, a policy, a customer preference the owner stated), ${canTeamEdit(businessId, "context") ? "write it to the right page with suggest_page_edit (the owner lets the team edit pages directly)" : "propose it with suggest_page_edit"}.`;
  return { prompt, items };
}

// ---- what a run read ----

type Load = { pageId?: string | null; label: string; mode: "always" | "fetched" | "memory" | "conversation"; chars: number; truncated?: boolean };

/**
 * What a run is starting with: replaces the task's always/memory/conversation rows (a
 * resumed run builds its prompt again); fetched pages accumulate.
 */
export function recordRunContext(businessId: string, taskId: string, teammateId: string, loads: Load[]) {
  db.delete(schema.contextLoads)
    .where(and(eq(schema.contextLoads.taskId, taskId), inArray(schema.contextLoads.mode, ["always", "memory", "conversation"])))
    .run();
  if (loads.length) db.insert(schema.contextLoads).values(loads.map((l) => ({ businessId, taskId, teammateId, pageId: l.pageId ?? null, label: l.label, mode: l.mode, chars: l.chars, truncated: l.truncated ?? false }))).run();
}

export function recordFetch(businessId: string, taskId: string, teammateId: string, page: Pick<ContextPage, "id" | "title">, chars: number) {
  db.insert(schema.contextLoads).values({ businessId, taskId, teammateId, pageId: page.id, label: page.title, mode: "fetched", chars }).run();
}

/** Per page, how many runs read it in the last 7 days, and by whom. */
export function usageThisWeek(businessId: string) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = db
    .select({ pageId: schema.contextLoads.pageId, taskId: schema.contextLoads.taskId, teammateId: schema.contextLoads.teammateId, mode: schema.contextLoads.mode })
    .from(schema.contextLoads)
    .where(and(eq(schema.contextLoads.businessId, businessId), gte(schema.contextLoads.createdAt, since)))
    .all();
  const out = new Map<string, { runs: number; fetched: number; byTeammate: Map<string, number> }>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.pageId) continue;
    const u = out.get(r.pageId) ?? { runs: 0, fetched: 0, byTeammate: new Map() };
    if (r.mode === "fetched") u.fetched++;
    const k = `${r.pageId}:${r.taskId}`;
    if (!seen.has(k)) {
      seen.add(k);
      u.runs++;
      u.byTeammate.set(r.teammateId, (u.byTeammate.get(r.teammateId) ?? 0) + 1);
    }
    out.set(r.pageId, u);
  }
  return out;
}

// ---- suggestions ----

export function createSuggestion(v: {
  businessId: string;
  teammate: Pick<Teammate, "id" | "name">;
  taskId?: string | null;
  page?: ContextPage;
  kind: SuggestionKind;
  body: string;
  title?: string;
  section?: ContextSection;
  reason?: string;
  source?: string;
}) {
  const s = db
    .insert(schema.contextSuggestions)
    .values({
      businessId: v.businessId,
      pageId: v.page?.id ?? null,
      teammateId: v.teammate.id,
      taskId: v.taskId ?? null,
      kind: v.kind,
      body: v.body.slice(0, 50_000),
      before: v.page?.body ?? null,
      title: v.title?.slice(0, 120) ?? null,
      section: v.section ?? null,
      reason: (v.reason ?? "").slice(0, 1000),
      source: (v.source ?? "").slice(0, 1000),
    })
    .returning()
    .get();
  logEvent({
    businessId: v.businessId,
    teammateId: v.teammate.id,
    taskId: v.taskId ?? null,
    type: "context_suggested",
    message: `${v.teammate.name} suggested ${v.kind === "new_page" ? `a new page "${v.title}"` : v.kind === "delete" ? `removing "${v.page?.title}"` : `an edit to "${v.page?.title}"`}`,
    data: { suggestionId: s.id, pageId: s.pageId },
  });
  return s;
}

/**
 * A teammate's edit when the owner lets the team edit pages itself (team-edits
 * "context"): applied straight away, and kept as an accepted suggestion so the change
 * and its reason stay visible in the page's history.
 */
export function applyPageEdit(v: {
  businessId: string;
  teammate: Pick<Teammate, "id" | "name">;
  taskId?: string | null;
  page?: ContextPage;
  kind: "append" | "replace" | "new_page";
  body: string;
  title?: string;
  section?: ContextSection;
  reason?: string;
  source?: string;
}) {
  const by = `teammate:${v.teammate.id}`;
  let page = v.page;
  if (v.kind === "new_page") {
    page = createPage(v.businessId, { title: v.title ?? "Untitled", section: v.section ?? "team_written", body: v.body, createdBy: by });
  } else if (page) {
    db.update(schema.contextPages)
      .set({ body: applySuggestion(page.body, { kind: v.kind, body: v.body }), blocks: null, updatedBy: by, updatedAt: now() })
      .where(eq(schema.contextPages.id, page.id))
      .run();
    if (page.key === "learned") writeTeamNotesFile(v.businessId);
  }
  if (!page) return undefined;
  db.insert(schema.contextSuggestions)
    .values({
      businessId: v.businessId,
      pageId: page.id,
      teammateId: v.teammate.id,
      taskId: v.taskId ?? null,
      kind: v.kind,
      body: v.body.slice(0, 50_000),
      before: v.kind === "new_page" ? null : (v.page?.body ?? null),
      title: v.title?.slice(0, 120) ?? null,
      section: v.section ?? null,
      reason: (v.reason ?? "").slice(0, 1000),
      source: (v.source ?? "").slice(0, 1000),
      status: "accepted",
      decidedAt: now(),
    })
    .run();
  logEvent({
    businessId: v.businessId,
    teammateId: v.teammate.id,
    taskId: v.taskId ?? null,
    type: "context_decided",
    message: v.kind === "new_page" ? `${v.teammate.name} added the page "${page.title}"` : `${v.teammate.name} edited "${page.title}"`,
    data: { pageId: page.id },
  });
  return page;
}

export function pendingSuggestions(businessId: string, pageId?: string) {
  return db
    .select()
    .from(schema.contextSuggestions)
    .where(and(eq(schema.contextSuggestions.businessId, businessId), eq(schema.contextSuggestions.status, "pending"), ...(pageId ? [eq(schema.contextSuggestions.pageId, pageId)] : [])))
    .orderBy(asc(schema.contextSuggestions.createdAt))
    .all();
}

/**
 * The owner's answer. Accepting applies it to the page as it is now (an append still
 * lands at the end even if the page changed since); `body` is the owner's edited text.
 * A "replace" whose text is what the page said when proposed only renames or moves it
 * (so a rename doesn't undo the owner's edits since); "delete" removes the page.
 */
export function decideSuggestion(businessId: string, id: string, accept: boolean, body?: string) {
  const s = db.select().from(schema.contextSuggestions).where(and(eq(schema.contextSuggestions.id, id), eq(schema.contextSuggestions.businessId, businessId))).get();
  if (!s || s.status !== "pending") return { error: "already_decided" as const };
  const text = body?.trim() ? body : s.body;
  let pageId = s.pageId;
  if (accept) {
    const by = s.teammateId ? `teammate:${s.teammateId}` : "owner";
    if (s.kind === "new_page") {
      pageId = createPage(businessId, { title: s.title ?? "Untitled", section: s.section ?? "team_written", body: text, createdBy: by }).id;
    } else {
      const page = s.pageId ? getPage(businessId, s.pageId) : undefined;
      if (!page) return { error: "page_gone" as const };
      if (s.kind === "delete") {
        if (page.key || page.kind === "database") return { error: "cant_delete" as const };
        // The suggestion outlives the page (its page_id would cascade it away).
        db.update(schema.contextSuggestions).set({ status: "accepted", decidedAt: now(), pageId: null }).where(eq(schema.contextSuggestions.id, s.id)).run();
        deletePage(businessId, page.id);
        logEvent({ businessId, teammateId: s.teammateId, taskId: s.taskId, type: "context_decided", message: `Owner removed the page "${page.title}"`, data: { suggestionId: s.id, pageId: null } });
        return { ok: true as const, pageId: null };
      }
      const sameText = s.kind === "replace" && s.before !== null && normalizeMarkdown(text) === normalizeMarkdown(s.before);
      const set: Partial<ContextPage> = { updatedBy: by, updatedAt: now() };
      if (!sameText) Object.assign(set, { body: applySuggestion(page.body, { kind: s.kind, body: text }), blocks: null });
      if (s.kind === "replace" && s.title?.trim()) set.title = s.title.trim().slice(0, 120);
      db.update(schema.contextPages).set(set).where(eq(schema.contextPages.id, page.id)).run();
      if (s.kind === "replace" && s.section && s.section !== page.section && SECTIONS.includes(s.section)) movePage(businessId, page.id, { parentId: null, section: s.section });
      if (page.key === "learned") writeTeamNotesFile(businessId);
    }
  }
  db.update(schema.contextSuggestions)
    .set({ status: accept ? "accepted" : "rejected", decidedAt: now(), body: text, pageId })
    .where(eq(schema.contextSuggestions.id, s.id))
    .run();
  logEvent({ businessId, teammateId: s.teammateId, taskId: s.taskId, type: "context_decided", message: accept ? "Owner accepted a page suggestion" : "Owner rejected a page suggestion", data: { suggestionId: s.id, pageId } });
  return { ok: true as const, pageId };
}
