import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ContextPage, ContextSection, ReaderMode, Teammate } from "@/db/schema";
import { applySuggestion, budgetPages, defaultReaderMode, forAgents, readerMode, SECTIONS } from "@/lib/context-text";
import { logEvent } from "@/lib/events";
import { t } from "@/lib/i18n";
import { teammatesRoot } from "@/lib/paths";
import { renderProfileMarkdown } from "@/lib/profile-markdown";
import type { BusinessProfile } from "@/lib/types";

/**
 * The Context workspace: pages about the business that the team reads (Notion-style,
 * edited on /b/[id]/context). Each page reaches a teammate "always" (in its prompt),
 * "when needed" (listed by title; read_page / search_context fetch it) or "never".
 * Teammates never write pages: they suggest_page_edit and the owner accepts or rejects.
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

export function getPage(businessId: string, id: string) {
  return db.select().from(schema.contextPages).where(and(eq(schema.contextPages.id, id), eq(schema.contextPages.businessId, businessId))).get();
}

export function pageByKey(businessId: string, key: string) {
  return db.select().from(schema.contextPages).where(and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.key, key))).get();
}

/** A page by id, exact title, or the closest title (case-insensitive, then contains). */
export function findPage(businessId: string, ref: string) {
  const pages = listPages(businessId);
  const r = ref.trim().replace(/^["“@]|["”]$/g, "").toLowerCase();
  return (
    pages.find((p) => p.id === ref.trim()) ??
    pages.find((p) => p.title.toLowerCase() === r) ??
    pages.find((p) => p.title.toLowerCase().includes(r)) ??
    pages.find((p) => r.includes(p.title.toLowerCase()))
  );
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
      .values({ businessId, key, section: v.section, title: v.title, body: v.body ?? "", kind: v.kind ?? "page", source: v.source ?? null, sortOrder: v.order, createdBy: "system", updatedBy: "system", updatedAt: now() })
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

export function createPage(businessId: string, v: { title: string; section: ContextSection; parentId?: string | null; body?: string; createdBy?: string }) {
  const last = db
    .select({ o: schema.contextPages.sortOrder })
    .from(schema.contextPages)
    .where(and(eq(schema.contextPages.businessId, businessId), eq(schema.contextPages.section, v.section)))
    .orderBy(desc(schema.contextPages.sortOrder))
    .get();
  return db
    .insert(schema.contextPages)
    .values({
      businessId,
      section: v.section,
      parentId: v.parentId ?? null,
      title: v.title.trim().slice(0, 120) || "Untitled",
      body: v.body ?? "",
      sortOrder: (last?.o ?? 0) + 1,
      createdBy: v.createdBy ?? "owner",
      updatedBy: v.createdBy ?? "owner",
      updatedAt: now(),
    })
    .returning()
    .get();
}

/** The owner's edit from the editor (autosave), or a rename / move. */
export function updatePage(businessId: string, id: string, patch: { title?: string; body?: string; blocks?: unknown[] | null; section?: ContextSection; checked?: boolean }) {
  const page = getPage(businessId, id);
  if (!page) return undefined;
  const set: Partial<ContextPage> = { updatedAt: now(), updatedBy: "owner" };
  if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 120) || page.title;
  if (patch.body !== undefined) set.body = patch.body.slice(0, 200_000);
  if (patch.blocks !== undefined) set.blocks = patch.blocks;
  if (patch.section && SECTIONS.includes(patch.section)) set.section = patch.section;
  if (patch.checked) set.lastCheckedAt = now();
  const row = db.update(schema.contextPages).set(set).where(eq(schema.contextPages.id, id)).returning().get();
  if (page.key === "learned") writeTeamNotesFile(businessId);
  return row;
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
  const pages = listPages(businessId).map((p) => p.id);
  if (!pages.length) return [];
  return db.select().from(schema.contextReaders).where(inArray(schema.contextReaders.pageId, pages)).all();
}

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
export function pagesFor(businessId: string, teammateId: string) {
  const pages = listPages(businessId);
  const rows = readerRows(businessId);
  const order = (p: ContextPage) => SECTIONS.indexOf(p.section);
  const sorted = [...pages].sort((a, b) => order(a) - order(b) || a.sortOrder - b.sortOrder);
  const mode = (p: ContextPage) => readerMode(p, teammateId, rows);
  return {
    always: sorted.filter((p) => p.kind === "page" && mode(p) === "always"),
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
export function contextPrompt(businessId: string, teammateId: string) {
  const { always, whenNeeded } = pagesFor(businessId, teammateId);
  const { text, items } = budgetPages(always);
  const more = whenNeeded.slice(0, 40).map((p) => `- ${p.title}${p.kind === "database" ? " (database)" : ""}`);
  if (!text && !more.length) return { prompt: "", items };
  const prompt = `## Business context (the owner's Context pages)
${text || "(no pages are always shared with you)"}
${more.length ? `\nMore pages, read when the task needs them (read_page, or search_context to find facts):\n${more.join("\n")}${whenNeeded.length > 40 ? `\n- … and ${whenNeeded.length - 40} more` : ""}\n` : ""}
When you use a fact from a page, cite it by title, e.g. (from "${always[0]?.title ?? whenNeeded[0]?.title ?? "Rules & policies"}"). Pages are the owner's; never contradict them. If you learn something durable that's missing or out of date (a new price, a policy, a customer preference the owner stated), propose it with suggest_page_edit.`;
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
  kind: "append" | "replace" | "new_page";
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
    message: `${v.teammate.name} suggested ${v.kind === "new_page" ? `a new page "${v.title}"` : `an edit to "${v.page?.title}"`}`,
    data: { suggestionId: s.id, pageId: s.pageId },
  });
  return s;
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
      db.update(schema.contextPages)
        .set({ body: applySuggestion(page.body, { kind: s.kind, body: text }), blocks: null, updatedBy: by, updatedAt: now() })
        .where(eq(schema.contextPages.id, page.id))
        .run();
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
