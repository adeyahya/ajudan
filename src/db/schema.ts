import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  createdAt: createdAt(),
});

export type TaskStatus = "queued" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";

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
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

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
});

export type DeliverableStatus = "draft" | "approved" | "published" | "rejected";

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
});

export type Business = typeof businesses.$inferSelect;
export type OnboardingMessage = typeof onboardingMessages.$inferSelect;
export type Teammate = typeof teammates.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type Job = typeof jobs.$inferSelect;
