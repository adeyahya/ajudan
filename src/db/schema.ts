import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  kind: text("kind").$type<TeammateKind>().notNull().default("ai"),
  /** Human teammates: WhatsApp number in international format, digits only ("6281234567890"). */
  phone: text("phone"),
  createdAt: createdAt(),
});

/** "waiting_human": a request sent to a human teammate on WhatsApp, open until it's closed. */
export type TaskStatus = "queued" | "running" | "waiting_approval" | "waiting_human" | "done" | "failed" | "cancelled";

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
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
}, (t) => [index("tasks_teammate_status_idx").on(t.teammateId, t.status)]);

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
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
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
  createdAt: createdAt(),
});

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
}, (t) => [index("activity_events_business_id_idx").on(t.businessId, t.id)]);

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
});

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
  createdAt: createdAt(),
});

export type JobKind = "onboarding_turn" | "onboarding_finalize" | "design_team" | "run_task";

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
