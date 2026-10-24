import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export type BusinessStatus = "onboarding" | "designing" | "team_proposed" | "active";

export const businesses = sqliteTable("businesses", {
  id: id(),
  name: text("name").notNull(),
  website: text("website"),
  /** Primary language code (src/lib/language.ts); all AI communication and output uses it. */
  language: text("language").notNull().default("en"),
  status: text("status").$type<BusinessStatus>().notNull().default("onboarding"),
  /** BusinessProfile JSON (see src/lib/types.ts), filled when onboarding is finalized. */
  profile: text("profile", { mode: "json" }).$type<import("@/lib/types").BusinessProfile>(),
  /** Claude Code session used by the onboarding interviewer, resumed each turn. */
  onboardingSessionId: text("onboarding_session_id"),
  /** True while the worker is producing an onboarding/team-design reply. */
  busy: integer("busy", { mode: "boolean" }).notNull().default(false),
  /** Team designer's explanation of the proposed team. */
  teamSummary: text("team_summary"),
  /**
   * Sites this business's browser may load, e.g. ["seller.shopee.co.id", "tiktok.com"].
   * Empty means no restriction. See src/lib/browser.ts.
   */
  browserSites: text("browser_sites", { mode: "json" }).$type<string[]>().notNull().default([]),
  /**
   * WhatsApp chats (groups, communities) teammates may read and post to. Everything
   * else in the linked WhatsApp stays invisible to them. See src/lib/whatsapp.ts.
   */
  whatsappChats: text("whatsapp_chats", { mode: "json" })
    .$type<{ jid: string; name: string }[]>()
    .notNull()
    .default([]),
  /** The owner as a person on the team (WhatsApp): approval requests also go there. */
  ownerHumanId: text("owner_human_id"),
  /** Domains teammates' sandboxed shell may reach (e.g. "api.orucraft.com"). */
  networkDomains: text("network_domains", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** Optional cap on the team's daily usage (sum of tasks.costUsd); 0 means no limit. See src/lib/budget.ts. */
  dailyBudgetUsd: real("daily_budget_usd")
    .notNull()
    .default(20) // the SQL default from an earlier design; changing it would rebuild the table
    .$defaultFn(() => 0),
  /** "weekly": the worker has an agent review the Context pages and propose a tidier layout (worker/handlers/reorganize.ts). Null: only when the owner asks. */
  contextTidy: text("context_tidy").$type<"weekly">(),
  /** When the last reorganize review finished. */
  contextTidiedAt: integer("context_tidied_at", { mode: "timestamp_ms" }),
  /**
   * What the AI team may change itself, per area (Business → Team permissions). Missing
   * keys take the defaults in src/lib/team-edits.ts.
   */
  teamEdits: text("team_edits", { mode: "json" }).$type<Partial<Record<import("@/lib/team-edits").EditArea, boolean>>>(),
  /**
   * Supervised: every change the team makes (outward actions, team edits) waits for the
   * owner's approval, whatever each teammate's freedom and Team permissions say. Off, those apply.
   */
  supervised: integer("supervised", { mode: "boolean" }).notNull().default(false),
  /** Which model provider runs the team (src/lib/backend.ts). Null: Claude Code with the local login. */
  aiBackend: text("ai_backend", { mode: "json" }).$type<import("@/lib/backend").BackendSettings>(),
  /** Voice-note replies on WhatsApp (src/lib/voice-settings.ts). Null: the default (on, mirroring). */
  voiceReplies: text("voice_replies", { mode: "json" }).$type<import("@/lib/voice-settings").VoiceSettings>(),
  /**
   * What teammates may do in each workspace collection (src/lib/agent-access.ts):
   * "read" (look only), "suggest" (changes to the owner's objects become suggestions),
   * "write" (change directly). Null or missing keys take DEFAULT_AGENT_ACCESS:
   * docs "suggest", library "write", contacts "suggest".
   */
  agentAccess: text("agent_access", { mode: "json" }).$type<Partial<import("@/lib/agent-access").AgentAccess>>(),
  createdAt: createdAt(),
});

export const onboardingMessages = sqliteTable("onboarding_messages", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
});

export type Autonomy = "draft" | "ask" | "auto";
export type TeammateStatus = "proposed" | "active" | "archived";
export type TeammateState = "idle" | "working" | "waiting" | "error";
/** "ai" teammates run in the worker; "human" ones are real people reached on WhatsApp. */
export type TeammateKind = "ai" | "human";

export const teammates = sqliteTable("teammates", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Key into ROLE_TEMPLATES (src/lib/roles.ts). */
  roleKey: text("role_key").notNull(),
  title: text("title").notNull(),
  /** Hex color used for the avatar in the office and the UI. */
  color: text("color").notNull().default("#6366f1"),
  /** Role-specific instructions appended to the system prompt. */
  persona: text("persona").notNull().default(""),
  /** Why the team designer proposed this teammate. */
  why: text("why"),
  responsibilities: text("responsibilities", { mode: "json" }).$type<string[]>().notNull().default([]),
  kpis: text("kpis", { mode: "json" }).$type<string[]>().notNull().default([]),
  autonomy: text("autonomy").$type<Autonomy>().notNull().default("ask"),
  /** Cron expression for recurring work, e.g. "0 9 * * 1". */
  schedule: text("schedule"),
  schedulePrompt: text("schedule_prompt"),
  status: text("status").$type<TeammateStatus>().notNull().default("proposed"),
  state: text("state").$type<TeammateState>().notNull().default("idle"),
  /** Short live status line shown as the speech bubble in the office. */
  currentActivity: text("current_activity"),
  /** Claude Code session resumed for this teammate's next task (continuity). */
  sessionId: text("session_id"),
  workspaceDir: text("workspace_dir"),
  deskIndex: integer("desk_index").notNull().default(0),
  /** May drive the business's browser (logged-in Shopee, TikTok…). Off by default. */
  browserAccess: integer("browser_access", { mode: "boolean" }).notNull().default(false),
  /** May read and post in the business's allowed WhatsApp chats. Off by default. */
  whatsappAccess: integer("whatsapp_access", { mode: "boolean" }).notNull().default(false),
  /** May run shell commands (sandboxed: own folder only, allowed domains only). Off by default. */
  shellAccess: integer("shell_access", { mode: "boolean" }).notNull().default(false),
  /** May read the connected code repositories and use GitHub issues through the owner's gh login. Off by default. */
  repoAccess: integer("repo_access", { mode: "boolean" }).notNull().default(false),
  kind: text("kind").$type<TeammateKind>().notNull().default("ai"),
  /** Human teammates: WhatsApp number in international format, digits only ("6281234567890"). */
  phone: text("phone"),
  createdAt: createdAt(),
});

/**
 * "waiting_approval": the run ended while the owner decides; the decision resumes its
 * Claude session (sessionId). "waiting_human": a request sent to a human teammate on
 * WhatsApp, open until it's closed. "cancelled": the owner stopped it (Cancel).
 */
export type TaskStatus = "queued" | "running" | "waiting_approval" | "waiting_human" | "done" | "failed" | "cancelled";
export type WatchPace = "live" | "normal" | "relaxed";

export const tasks = sqliteTable("tasks", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id")
    .notNull()
    .references(() => teammates.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  status: text("status").$type<TaskStatus>().notNull().default("queued"),
  result: text("result"),
  costUsd: real("cost_usd").notNull().default(0),
  /** "user", "schedule", or "teammate:<id>" when delegated. */
  createdBy: text("created_by").notNull().default("user"),
  /**
   * The task this one was delegated from (e.g. the manager's task for an owner
   * request). When all children finish, the manager reports back. See src/lib/manager.ts.
   */
  parentTaskId: text("parent_task_id"),
  /** Files the owner (or the delegating teammate) attached: "media/…" or "work/…" paths. */
  attachments: text("attachments", { mode: "json" }).$type<string[]>().notNull().default([]),
  /**
   * Claude Code session of this task's run: resumed after an approval decision, and
   * set on a follow-up task (capability granted, WhatsApp reply) so it carries on
   * from the conversation that asked. A missing session falls back to task history.
   */
  sessionId: text("session_id"),
  /** The deliverable this task revises (the owner's "Needs changes", src/lib/feedback.ts). */
  deliverableId: text("deliverable_id"),
  /** Someone is waiting on WhatsApp right now (a live chat): runs in its own lane, answers fast. */
  urgent: integer("urgent", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("tasks_teammate_status_idx").on(t.teammateId, t.status),
  index("tasks_teammate_created_idx").on(t.teammateId, t.createdAt),
  index("tasks_business_status_idx").on(t.businessId, t.status),
  index("tasks_business_finished_idx").on(t.businessId, t.finishedAt),
  index("tasks_parent_idx").on(t.parentTaskId),
  index("tasks_deliverable_idx").on(t.deliverableId),
]);

/**
 * "superseded": the run that asked can't be resumed (it restarts from scratch and asks
 * again). "cancelled": the owner cancelled the task that asked.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "superseded" | "cancelled";

export const approvals = sqliteTable("approvals", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id")
    .notNull()
    .references(() => teammates.id, { onDelete: "cascade" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  input: text("input", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  summary: text("summary").notNull(),
  status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
  note: text("note"),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [index("approvals_business_status_idx").on(t.businessId, t.status)]);

/**
 * Nothing a teammate makes is posted by Ajudan: "ready_to_post" means the teammate finished
 * it for the owner to post themselves (mark_ready_to_post / draft_outbound_message), and
 * "published" is the owner's own "I posted it" (also what the old simulated publish tools set).
 */
export type DeliverableStatus = "draft" | "ready_to_post" | "approved" | "published" | "rejected";

export const deliverables = sqliteTable("deliverables", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id").references(() => teammates.id, { onDelete: "set null" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  /** e.g. "social_post", "blog_post", "email", "report", "plan", "ad_copy". */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  /** Free-form channel, e.g. "instagram", "newsletter", "website". */
  channel: text("channel"),
  status: text("status").$type<DeliverableStatus>().notNull().default("draft"),
  /** Files that belong to this work (e.g. carousel slides), relative to the business folder: work/images/… */
  attachments: text("attachments", { mode: "json" }).$type<string[]>().notNull().default([]),
  /**
   * Earlier versions, oldest first: what the row held before each update_deliverable
   * (a teammate's revision after the owner's or the manager's feedback). See src/lib/deliverables.ts.
   */
  versions: text("versions", { mode: "json" }).$type<DeliverableVersion[]>().notNull().default([]),
  /** A "/"-separated folder path in Docs ("Marketing/Q3"), or null for the top level. */
  folder: text("folder"),
  /** "owner" or "teammate:<id>". Null on rows made before this column: read teammateId instead. */
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  /** In Trash since then (src/lib/trash.ts); null when live. */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [
  index("deliverables_business_created_idx").on(t.businessId, t.createdAt),
  index("deliverables_business_deleted_idx").on(t.businessId, t.deletedAt),
  index("deliverables_business_status_idx").on(t.businessId, t.status),
  index("deliverables_teammate_idx").on(t.teammateId),
  index("deliverables_task_idx").on(t.taskId),
]);

export type DeliverableVersion = {
  title: string;
  content: string;
  attachments: string[];
  /** ISO timestamp of when this version was replaced. */
  savedAt: string;
  /** Who made the version that replaced it. */
  byTeammateId: string | null;
};

export const activityEvents = sqliteTable("activity_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id"),
  taskId: text("task_id"),
  /** e.g. "task_started", "tool", "text", "task_done", "approval_requested", "onboarding_reply". */
  type: text("type").notNull(),
  message: text("message").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [
  index("activity_events_business_id_idx").on(t.businessId, t.id),
  index("activity_events_task_type_idx").on(t.taskId, t.type, t.id),
  index("activity_events_business_type_idx").on(t.businessId, t.type, t.createdAt),
]);

/**
 * The WhatsApp conversation with human teammates, as Ajudan saw it: requests and
 * replies the AI team sent (out) and what the person sent back (in, with media
 * copied into media/). The UI and the agents read this, never wacli directly.
 */
export const humanMessages = sqliteTable("human_messages", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  humanId: text("human_id")
    .notNull()
    .references(() => teammates.id, { onDelete: "cascade" }),
  direction: text("direction").$type<"in" | "out">().notNull(),
  /** The AI teammate who sent it (out), or null for the owner. */
  fromTeammateId: text("from_teammate_id"),
  /** The human request (task) it belongs to, if any. */
  taskId: text("task_id"),
  text: text("text").notNull().default(""),
  attachments: text("attachments", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** WhatsApp message id (dedupes inbound messages). */
  waMessageId: text("wa_message_id").unique(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("human_messages_human_sent_idx").on(t.humanId, t.sentAt)]);

/**
 * Credentials the team may use (API keys, tokens). Only the name, the hosts it may be
 * sent to and a note live here; the value is in the macOS Keychain (src/lib/secrets.ts).
 */
export const secrets = sqliteTable("secrets", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  /** Referenced by teammates as {{secret.NAME}}, e.g. "ORUCRAFT_API". */
  name: text("name").notNull(),
  hosts: text("hosts", { mode: "json" }).$type<string[]>().notNull().default([]),
  note: text("note").notNull().default(""),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

/**
 * A WhatsApp message the team sent and expects an answer to (someone outside the
 * team, or a group asked to reply). The worker watches the chat: replies go to the
 * teammate who wrote, and if none comes by replyBy, that teammate is reminded.
 * See worker/replies.ts.
 */
export const waWatches = sqliteTable("wa_watches", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  jid: text("jid").notNull(),
  name: text("name").notNull(),
  teammateId: text("teammate_id")
    .notNull()
    .references(() => teammates.id, { onDelete: "cascade" }),
  /** The task that sent it (its owner request gets the follow-up). */
  taskId: text("task_id"),
  /** What the team wants back, e.g. "confirm a 50-pc bulk order". */
  purpose: text("purpose").notNull().default(""),
  message: text("message").notNull().default(""),
  status: text("status").$type<"waiting" | "replied" | "no_reply" | "closed">().notNull().default("waiting"),
  replyBy: integer("reply_by", { mode: "timestamp_ms" }).notNull(),
  /** Messages after this were already handed over. */
  seenUntil: integer("seen_until", { mode: "timestamp_ms" }).notNull(),
  lastReplyAt: integer("last_reply_at", { mode: "timestamp_ms" }),
  /** When the team last wrote in this chat. */
  lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
  /**
   * How fast to answer: "live" (someone chatting now), "relaxed" (they answer in their
   * own time), or "normal", which turns live when they answer quickly. See src/lib/watches.ts.
   */
  pace: text("pace").$type<WatchPace>().notNull().default("normal"),
  createdAt: createdAt(),
}, (t) => [index("wa_watches_business_status_idx").on(t.businessId, t.status)]);

export type JobKind = "onboarding_turn" | "onboarding_finalize" | "design_team" | "run_task" | "consolidate_memory" | "render_edit" | "context_test_ask" | "context_reorganize";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").$type<JobKind>().notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("queued"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
}, (t) => [index("jobs_status_idx").on(t.status)]);

/**
 * The owner's organization of the media library (src/lib/assets.ts): one row per file
 * under media/ that the owner titled, noted, tagged, starred or put in an album.
 * Files without a row are simply unorganized. Teammates see this in list_media.
 */
export const assets = sqliteTable("assets", {
  /** Folder-relative path, "media/…". */
  path: text("path").primaryKey(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  /** What it's for / how to use it ("use for the payday promo, not the logo version"). */
  note: text("note").notNull().default(""),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  album: text("album"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  /** "owner" or "teammate:<id>". */
  createdBy: text("created_by").notNull().default("owner"),
  updatedBy: text("updated_by").notNull().default("owner"),
  /**
   * In Trash since then (src/lib/trash.ts): the file stays where it is but the library and
   * list_media hide it; purging deletes the file. Null when live.
   */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [index("assets_business_idx").on(t.businessId), index("assets_business_deleted_idx").on(t.businessId, t.deletedAt)]);


/**
 * Details about files in the folder that are slow to work out again: a markdown file's
 * title (read from its head) and ffprobe's results for media. Valid while the file's
 * size and mtime match; disk stays the truth (src/lib/file-meta.ts). Rows for files that
 * are gone are pruned by worker/maintenance.ts.
 */
export const fileMeta = sqliteTable("file_meta", {
  /** Folder-relative path, "work/…", "media/…", "teammates/…". */
  path: text("path").primaryKey(),
  bytes: integer("bytes").notNull(),
  /** The file's mtime in whole milliseconds. */
  mtimeMs: integer("mtime_ms").notNull(),
  /** Markdown: the front-matter title or first heading (null when it has none). */
  title: text("title"),
  /** Media: what ffprobe found (src/lib/media.ts MediaInfo, without kind and bytes). */
  probe: text("probe", { mode: "json" }).$type<{ width?: number; height?: number; durationSec?: number; fps?: number; hasAudio?: boolean }>(),
});
/**
 * Local git repositories the owner connected (src/lib/repos.ts). Teammates with
 * repoAccess read them (never write) and file GitHub issues through the owner's gh login.
 */
export const repositories = sqliteTable("repositories", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  /** What teammates call it ("ajudan"); unique per business. */
  name: text("name").notNull(),
  /** Absolute path of the working tree's top folder. */
  path: text("path").notNull(),
  /** "owner/name" on github.com from the origin remote, or null when it isn't on GitHub. */
  githubRepo: text("github_repo"),
  createdAt: createdAt(),
});

export type ContactKind = "customer" | "supplier" | "partner" | "team" | "other";

/** The business's address book, kept by the owner (src/lib/contacts.ts); teammates can look people up. */
export const contacts = sqliteTable("contacts", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Digits with country code, no "+" (like teammates.phone). */
  phone: text("phone"),
  email: text("email"),
  company: text("company"),
  kind: text("kind").$type<ContactKind>().notNull().default("customer"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  /** "owner", or "teammate:<id>" for a contact a teammate added (save_contact). */
  createdBy: text("created_by").notNull().default("owner"),
  updatedBy: text("updated_by").notNull().default("owner"),
  /** When to get back to this person (Home lists the ones due), with what for. */
  followUpAt: integer("follow_up_at", { mode: "timestamp_ms" }),
  followUpNote: text("follow_up_note").notNull().default(""),
  /** The owner's own fields ("Birthday" → "12 May"). */
  fields: text("fields", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  /** In Trash since then (src/lib/trash.ts); null when live. */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [
  index("contacts_business_name_idx").on(t.businessId, t.name),
  index("contacts_business_deleted_idx").on(t.businessId, t.deletedAt),
  index("contacts_business_follow_up_idx").on(t.businessId, t.followUpAt),
]);

export type EditKind = "video" | "audio";
export type EditStatus = "draft" | "queued" | "rendering" | "done" | "failed";

/**
 * A video or audio edit made in the Studio editors (src/lib/edits.ts). The spec is the
 * edit decision list; the worker renders it with ffmpeg (no Claude) into media/.
 */
export const edits = sqliteTable("edits", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  kind: text("kind").$type<EditKind>().notNull(),
  title: text("title").notNull(),
  spec: text("spec", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<EditStatus>().notNull().default("draft"),
  /** The last render, "media/…". */
  output: text("output"),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

/** Sections of the Context workspace, in tree order. Labels are i18n (context.section.*). */
export type ContextSection = "business" | "product" | "people" | "how_we_work" | "team_written";
export type ReaderMode = "always" | "when_needed" | "never";

/**
 * The Context workspace (src/lib/context.ts): Notion-style pages the team reads. The
 * markdown body is what teammates read; `blocks` is the editor's own JSON, kept only so
 * the owner's callouts, mentions and galleries round-trip (null after the body changed
 * elsewhere, e.g. an accepted suggestion: the editor re-reads the markdown).
 */
export type ContextPageKind = "page" | "database" | "mindmap";

export const contextPages = sqliteTable("context_pages", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  section: text("section").$type<ContextSection>().notNull().default("business"),
  title: text("title").notNull(),
  /**
   * "database": a table view over app data (`source`), not free text. "mindmap": a map
   * whose `body` is a nested bullet list under the title (parseMindMap in context-text.ts).
   */
  kind: text("kind").$type<ContextPageKind>().notNull().default("page"),
  /** For database pages: what it shows ("contacts"). */
  source: text("source"),
  /** Pages Ajudan created and keeps track of: "about", "learned", "products", "policies", "contacts". */
  key: text("key"),
  body: text("body").notNull().default(""),
  blocks: text("blocks", { mode: "json" }).$type<unknown[]>(),
  /** The page icon: an emoji, or "lucide:<name>". Null: the default for the page's key/kind; "": none. */
  icon: text("icon"),
  /** Cover image, folder-relative ("media/…"), or null. */
  cover: text("cover"),
  sortOrder: real("sort_order").notNull().default(0),
  /** "owner", "system" or "teammate:<id>". */
  createdBy: text("created_by").notNull().default("owner"),
  updatedBy: text("updated_by").notNull().default("owner"),
  /** When the owner last confirmed the page is still true. */
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  /** In Trash since then (src/lib/trash.ts; its sub-pages moved up when it went); null when live. */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("context_pages_business_idx").on(t.businessId, t.section),
  uniqueIndex("context_pages_key_idx").on(t.businessId, t.key),
  index("context_pages_business_deleted_idx").on(t.businessId, t.deletedAt),
]);

/** Per teammate, how a page reaches them. No row: the default (defaultReaderMode in src/lib/context.ts). */
export const contextReaders = sqliteTable("context_readers", {
  id: id(),
  pageId: text("page_id")
    .notNull()
    .references(() => contextPages.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id")
    .notNull()
    .references(() => teammates.id, { onDelete: "cascade" }),
  mode: text("mode").$type<ReaderMode>().notNull(),
}, (t) => [index("context_readers_page_idx").on(t.pageId, t.teammateId)]);

export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type SuggestionKind = "append" | "replace" | "new_page" | "delete";

/**
 * A change a teammate (or the manager, from the owner's chat) proposes to a page.
 * Teammates never write pages; the owner accepts or rejects. "append" adds `body` at
 * the end, "replace" swaps the whole page for `body`, "new_page" creates `title`, "delete"
 * removes the page. A "replace" may also carry `title` (rename) and `section` (move): the
 * reorganize review uses that to retitle, move and merge pages.
 */
export const contextSuggestions = sqliteTable("context_suggestions", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  pageId: text("page_id").references(() => contextPages.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id").references(() => teammates.id, { onDelete: "set null" }),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  kind: text("kind").$type<SuggestionKind>().notNull(),
  body: text("body").notNull(),
  /** The page as it was when proposed (to show what changed since). */
  before: text("before"),
  /** new_page: its title; replace: a new title for the page (reorganize). */
  title: text("title"),
  section: text("section").$type<ContextSection>(),
  reason: text("reason").notNull().default(""),
  /** Where it came from: "you told Bu Rina on WhatsApp, 22 Oct: …". */
  source: text("source").notNull().default(""),
  status: text("status").$type<SuggestionStatus>().notNull().default("pending"),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (t) => [
  index("context_suggestions_business_idx").on(t.businessId, t.status),
  index("context_suggestions_page_idx").on(t.pageId, t.status),
  index("context_suggestions_task_idx").on(t.taskId),
]);

/**
 * What a task's run read: always-pages put in its prompt, pages it fetched (read_page),
 * its memory and the conversation. Feeds the inspector and page usage counts.
 */
export const contextLoads = sqliteTable("context_loads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id").notNull(),
  pageId: text("page_id").references(() => contextPages.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  mode: text("mode").$type<"always" | "fetched" | "memory" | "conversation">().notNull(),
  chars: integer("chars").notNull().default(0),
  truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  index("context_loads_task_idx").on(t.taskId),
  index("context_loads_page_idx").on(t.pageId, t.createdAt),
  index("context_loads_business_created_idx").on(t.businessId, t.createdAt),
  index("context_loads_teammate_idx").on(t.businessId, t.teammateId, t.id),
]);

/** A dry run from the inspector: what a teammate would answer from its context alone (no tools, nothing sent). */
export const contextAsks = sqliteTable("context_asks", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  teammateId: text("teammate_id")
    .notNull()
    .references(() => teammates.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer"),
  cited: text("cited", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status").$type<"queued" | "done" | "failed">().notNull().default("queued"),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: createdAt(),
});

export type Business = typeof businesses.$inferSelect;
export type OnboardingMessage = typeof onboardingMessages.$inferSelect;
export type Teammate = typeof teammates.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type HumanMessage = typeof humanMessages.$inferSelect;
export type Secret = typeof secrets.$inferSelect;
export type WaWatch = typeof waWatches.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Edit = typeof edits.$inferSelect;
export type ContextPage = typeof contextPages.$inferSelect;
export type ContextReader = typeof contextReaders.$inferSelect;
export type ContextSuggestion = typeof contextSuggestions.$inferSelect;
export type ContextLoad = typeof contextLoads.$inferSelect;
export type ContextAsk = typeof contextAsks.$inferSelect;
export type FileMeta = typeof fileMeta.$inferSelect;

/**
 * Workspace objects links and history refer to. "doc" is a Context page, "deliverable" a
 * deliverables row (Work / Docs), "asset" a library file (id = its "media/…" path),
 * "contact" and "task" their rows.
 */
export type ObjectType = "doc" | "deliverable" | "asset" | "contact" | "task";

/** Any object ↔ any object (src/lib/links.ts). Stored once, from → to; backlinks read `to`. */
export const links = sqliteTable("links", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  fromType: text("from_type").$type<ObjectType>().notNull(),
  fromId: text("from_id").notNull(),
  toType: text("to_type").$type<ObjectType>().notNull(),
  toId: text("to_id").notNull(),
  /** "owner" or "teammate:<id>". */
  createdBy: text("created_by").notNull().default("owner"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("links_unique_idx").on(t.businessId, t.fromType, t.fromId, t.toType, t.toId),
  index("links_to_idx").on(t.businessId, t.toType, t.toId),
]);

export type HistoryAction = "create" | "update" | "delete" | "restore";

/** A snapshot of an object per change, with who made it (src/lib/object-history.ts). */
export const objectHistory = sqliteTable("object_history", {
  id: id(),
  businessId: text("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  objectType: text("object_type").$type<ObjectType>().notNull(),
  objectId: text("object_id").notNull(),
  /** The object's row as it was after this change (before it, for "delete"). */
  snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  action: text("action").$type<HistoryAction>().notNull(),
  /** "owner", "system" or "teammate:<id>". */
  by: text("by").notNull().default("owner"),
  createdAt: createdAt(),
}, (t) => [
  index("object_history_object_idx").on(t.businessId, t.objectType, t.objectId, t.createdAt),
  index("object_history_business_idx").on(t.businessId, t.createdAt),
]);
