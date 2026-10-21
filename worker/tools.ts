/**
 * In-process MCP server "biz": the tools a teammate uses to save work, coordinate
 * with the team and (simulated) act on the outside world. Built per task so every
 * handler knows which business, teammate and task it is acting for.
 */
import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { DeliverableStatus, Teammate } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { slugify } from "@/lib/folders";
import { renderHtmlToPng } from "@/lib/images";
import { dataDir } from "@/lib/paths";
import { createTask } from "@/lib/tasks";
import { syncDeliverableFile } from "@/lib/workfiles";

export const BIZ_SERVER = "biz";

/** Tools that act inside Ajudan only: always allowed. */
export const SAFE_BIZ_TOOLS = [
  "save_deliverable",
  "list_deliverables",
  "assign_task",
  "set_status",
  "render_image",
  "team_status",
  "task_results",
  "pending_approvals",
].map(
  (t) => `mcp__${BIZ_SERVER}__${t}`,
);
/** Tools that reach the outside world: gated by the teammate's autonomy. */
export const OUTWARD_BIZ_TOOLS = ["publish_deliverable", "send_message", "confirm_browser_action"].map(
  (t) => `mcp__${BIZ_SERVER}__${t}`,
);

export type BizContext = {
  businessId: string;
  teammate: Pick<Teammate, "id" | "name" | "title">;
  taskId: string;
  /** Other active teammates this teammate may delegate to. Empty = no assign_task. */
  roster: Pick<Teammate, "id" | "name" | "title">[];
  /** The teammate has the business browser this task (adds confirm_browser_action). */
  browser?: boolean;
  /** The teammate's working folder (rendered images go to its work/images/). */
  cwd: string;
  /** The manager gets team-overview tools, and its delegations link back to this task. */
  isManager?: boolean;
};

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const SIMULATED =
  "(Simulated: Ajudan has no real integrations for this channel yet, so nothing was actually sent outside. The owner can copy it from the Work page.)";

export function createBizServer(ctx: BizContext) {
  const { businessId, teammate, taskId } = ctx;
  const ev = (type: string, message: string, data?: Record<string, unknown>) =>
    logEvent({ businessId, teammateId: teammate.id, taskId, type, message, data });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input shapes
  const tools: SdkMcpToolDefinition<any>[] = [
    tool(
      "save_deliverable",
      "Save a finished or draft piece of work (post, article, email, plan, report…) so the owner can review it. Call this for every piece of work you produce. Returns the deliverable id.",
      {
        kind: z
          .string()
          .describe('Type of work, e.g. "social_post", "blog_post", "email", "report", "plan", "ad_copy"'),
        title: z.string().describe("Short descriptive title"),
        content: z.string().describe("The full content, ready to use"),
        channel: z.string().optional().describe('Where it is meant to go, e.g. "instagram", "newsletter"'),
        images: z
          .array(z.string())
          .optional()
          .describe("Images that belong to this work, in order (paths returned by render_image), e.g. carousel slides"),
      },
      async (a) => {
        const attachments = (a.images ?? []).map((p: string) => p.replace(/^\.?\//, ""));
        const missing = attachments.filter(
          (p: string) => !p.startsWith("work/images/") || !fs.existsSync(path.join(dataDir(), p)),
        );
        if (missing.length) return fail(`Unknown image(s): ${missing.join(", ")}. Use the paths render_image returned.`);
        const d = db
          .insert(schema.deliverables)
          .values({
            businessId,
            teammateId: teammate.id,
            taskId,
            kind: a.kind,
            title: a.title,
            content: a.content,
            channel: a.channel ?? null,
            status: "draft",
            attachments,
          })
          .returning({ id: schema.deliverables.id })
          .get();
        syncDeliverableFile(d.id);
        ev("deliverable_saved", `${teammate.name} saved "${a.title}"`, { deliverableId: d.id, kind: a.kind });
        return ok(`Saved as draft. deliverable_id: ${d.id}`);
      },
    ),

    tool(
      "render_image",
      "Design an image (social post, carousel slide, poster, banner) as one self-contained HTML page and render it to PNG. Use inline CSS; Google Fonts and image URLs are fine. Then Read the PNG to check it, and attach it to your work with save_deliverable(images=[…]).",
      {
        name: z.string().describe('Short file name, e.g. "carousel-1-cover"'),
        html: z.string().describe("Complete HTML document sized exactly to width × height"),
        width: z.number().int().min(200).max(4096).optional().describe("Pixels (default 1080)"),
        height: z.number().int().min(200).max(4096).optional().describe("Pixels (default 1350, Instagram portrait)"),
      },
      async (a) => {
        const width = a.width ?? 1080;
        const height = a.height ?? 1350;
        const file = `${new Date().toISOString().slice(0, 10)}-${slugify(a.name)}-${taskId.slice(0, 4)}.png`;
        const inWorkspace = path.join(ctx.cwd, "work", "images", file);
        await renderHtmlToPng({ html: a.html, width, height, outPath: inWorkspace });
        // The business folder keeps a copy next to the .md files of the work.
        const rel = path.join("work", "images", file);
        fs.mkdirSync(path.join(dataDir(), "work", "images"), { recursive: true });
        fs.copyFileSync(inWorkspace, path.join(dataDir(), rel));
        ev("image_rendered", `${teammate.name} designed ${file}`, { path: rel });
        return ok(`Rendered ${width}×${height}. Check it with Read("${path.relative(ctx.cwd, inWorkspace)}"). Attach it as "${rel}".`);
      },
    ),

    tool(
      "list_deliverables",
      "List this business's saved deliverables (newest first), optionally filtered by status.",
      { status: z.enum(["draft", "approved", "published", "rejected"]).optional() },
      async (a) => {
        const filters = [eq(schema.deliverables.businessId, businessId)];
        if (a.status) filters.push(eq(schema.deliverables.status, a.status as DeliverableStatus));
        const rows = db
          .select({
            id: schema.deliverables.id,
            kind: schema.deliverables.kind,
            title: schema.deliverables.title,
            channel: schema.deliverables.channel,
            status: schema.deliverables.status,
            teammate: schema.teammates.name,
            content: schema.deliverables.content,
          })
          .from(schema.deliverables)
          .leftJoin(schema.teammates, eq(schema.teammates.id, schema.deliverables.teammateId))
          .where(and(...filters))
          .orderBy(desc(schema.deliverables.createdAt))
          .limit(30)
          .all();
        if (!rows.length) return ok("No deliverables yet.");
        return ok(
          rows
            .map(
              (r) =>
                `- [${r.status}] ${r.title} (${r.kind}${r.channel ? `, ${r.channel}` : ""}) by ${r.teammate ?? "?"} — id ${r.id}\n  ${r.content.replace(/\s+/g, " ").slice(0, 160)}`,
            )
            .join("\n"),
        );
      },
    ),

    tool(
      "set_status",
      "Update your short live status line (shown as your speech bubble in the office), e.g. 'Drafting 3 Instagram captions'.",
      { text: z.string().describe("Under 80 characters") },
      async (a) => {
        const text = a.text.slice(0, 120);
        db.update(schema.teammates).set({ currentActivity: text }).where(eq(schema.teammates.id, teammate.id)).run();
        ev("status", text);
        return ok("Status updated.");
      },
    ),

    tool(
      "publish_deliverable",
      "Publish a saved deliverable to a channel (outward action). Use the deliverable_id returned by save_deliverable.",
      {
        deliverable_id: z.string(),
        channel: z.string().describe('e.g. "instagram", "blog", "newsletter"'),
      },
      async (a) => {
        const d = db
          .select()
          .from(schema.deliverables)
          .where(and(eq(schema.deliverables.id, a.deliverable_id), eq(schema.deliverables.businessId, businessId)))
          .get();
        if (!d) return fail(`No deliverable with id ${a.deliverable_id} in this business.`);
        db.update(schema.deliverables)
          .set({ status: "published", channel: a.channel })
          .where(eq(schema.deliverables.id, d.id))
          .run();
        syncDeliverableFile(d.id);
        ev("deliverable_published", `${teammate.name} published "${d.title}" to ${a.channel}`, {
          deliverableId: d.id,
          channel: a.channel,
          simulated: true,
        });
        return ok(`Marked "${d.title}" as published to ${a.channel}. ${SIMULATED}`);
      },
    ),

    tool(
      "send_message",
      "Send a message (email, DM, outreach) to someone outside the business (outward action).",
      {
        channel: z.string().describe('e.g. "email", "instagram_dm", "linkedin"'),
        to: z.string().describe("Recipient (name, handle or address)"),
        subject: z.string().describe("Subject or short headline"),
        body: z.string().describe("Full message body"),
      },
      async (a) => {
        const d = db
          .insert(schema.deliverables)
          .values({
            businessId,
            teammateId: teammate.id,
            taskId,
            kind: "outbound_message",
            title: `To ${a.to}: ${a.subject}`,
            content: a.body,
            channel: a.channel,
            status: "published",
          })
          .returning({ id: schema.deliverables.id })
          .get();
        syncDeliverableFile(d.id);
        ev("message_sent", `${teammate.name} sent a ${a.channel} message to ${a.to}`, {
          deliverableId: d.id,
          simulated: true,
        });
        return ok(`Message to ${a.to} recorded as sent (id ${d.id}). ${SIMULATED}`);
      },
    ),
  ];

  if (ctx.browser) {
    tools.push(
      tool(
        "confirm_browser_action",
        "Ask the owner before you commit a change in the business browser: submitting a form, saving or publishing, replying to a customer, changing prices or stock, deleting anything. Describe exactly what you will do. Only proceed if this returns approved.",
        {
          site: z.string().describe('The site, e.g. "seller.shopee.co.id"'),
          action: z.string().describe("One sentence: what you will do"),
          details: z.string().describe("The exact values or text you will submit"),
        },
        async (a) => {
          ev("browser_action_approved", `${teammate.name} may now: ${a.action} (${a.site})`, { site: a.site });
          return ok(`Approved: ${a.action}. Do exactly this on ${a.site}, then report what changed. Ask again for anything else.`);
        },
      ),
    );
  }

  if (ctx.roster.length) {
    tools.push(
      tool(
        "assign_task",
        `Delegate a task to another teammate. Available: ${ctx.roster.map((r) => `${r.name} (${r.title})`).join(", ")}. Give clear, self-contained instructions.`,
        {
          teammate_name: z.string().describe("First name of the teammate"),
          instructions: z.string().describe("What to do, with all context they need"),
        },
        async (a) => {
          const target = ctx.roster.find((r) => r.name.toLowerCase() === a.teammate_name.trim().toLowerCase());
          if (!target) {
            if (a.teammate_name.trim().toLowerCase() === teammate.name.toLowerCase())
              return fail("You can't assign a task to yourself; just do the work.");
            return fail(`No teammate named "${a.teammate_name}". Available: ${ctx.roster.map((r) => r.name).join(", ")}.`);
          }
          const task = createTask({
            businessId,
            teammateId: target.id,
            instructions: a.instructions,
            createdBy: `teammate:${teammate.id}`,
            // The manager's report-back waits for everything delegated from this task.
            parentTaskId: ctx.isManager ? taskId : null,
          });
          ev("delegated", `${teammate.name} asked ${target.name}: ${task.title}`, {
            from: teammate.id,
            to: target.id,
            delegatedTaskId: task.id,
          });
          return ok(`Assigned to ${target.name} (task ${task.id}). They'll work on it after you; check later with list_deliverables.`);
        },
      ),
    );
  }

  if (ctx.isManager) {
    const mates = () =>
      db
        .select()
        .from(schema.teammates)
        .where(and(eq(schema.teammates.businessId, businessId), eq(schema.teammates.status, "active")))
        .all()
        .filter((m) => m.id !== teammate.id);
    tools.push(
      tool("team_status", "See what each teammate is doing right now, their open tasks and what they're allowed to do.", {}, async () => {
        const open = db
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.businessId, businessId), inArray(schema.tasks.status, ["queued", "running", "waiting_approval"])))
          .all();
        const lines = mates().map((m) => {
          const mine = open.filter((t) => t.teammateId === m.id).map((t) => `${t.title} (${t.status.replace("_", " ")})`);
          const can = [m.browserAccess && "browser", m.whatsappAccess && "WhatsApp"].filter(Boolean).join(", ") || "no browser/WhatsApp";
          return `- ${m.name}, ${m.title}: ${m.state}${m.currentActivity ? ` (“${m.currentActivity}”)` : ""}; freedom ${m.autonomy}; ${can}${mine.length ? `; open: ${mine.join("; ")}` : ""}`;
        });
        return ok(lines.join("\n") || "No teammates yet.");
      }),
      tool(
        "task_results",
        "Read recent finished work from the team (results of their tasks), optionally for one teammate.",
        { teammate_name: z.string().optional(), limit: z.number().int().min(1).max(20).optional() },
        async (a) => {
          const target = a.teammate_name
            ? mates().find((m) => m.name.toLowerCase() === a.teammate_name!.trim().toLowerCase())
            : undefined;
          if (a.teammate_name && !target) return fail(`No teammate named "${a.teammate_name}".`);
          const rows = db
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.businessId, businessId),
                inArray(schema.tasks.status, ["done", "failed"]),
                ...(target ? [eq(schema.tasks.teammateId, target.id)] : []),
              ),
            )
            .orderBy(desc(schema.tasks.finishedAt))
            .limit(a.limit ?? 8)
            .all();
          const names = new Map(mates().map((m) => [m.id, m.name]));
          return ok(
            rows
              .filter((r) => r.teammateId !== teammate.id)
              .map((r) => `### ${names.get(r.teammateId) ?? "?"}: ${r.title} (${r.status}, ${r.finishedAt?.toISOString().slice(0, 16)})\n${(r.result ?? "").slice(0, 1200)}`)
              .join("\n\n") || "No finished work yet.",
          );
        },
      ),
      tool("pending_approvals", "List what's waiting for the owner's approval.", {}, async () => {
        const rows = db
          .select()
          .from(schema.approvals)
          .where(and(eq(schema.approvals.businessId, businessId), eq(schema.approvals.status, "pending")))
          .all();
        return ok(rows.map((r) => `- ${r.summary}`).join("\n") || "Nothing is waiting for approval.");
      }),
    );
  }

  return createSdkMcpServer({ name: BIZ_SERVER, version: "0.1.0", tools, alwaysLoad: true });
}
