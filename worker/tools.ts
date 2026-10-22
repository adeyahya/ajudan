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
import { describeAsset, downloadFreeAsset, readCredits, searchFreeAssets } from "@/lib/free-assets";
import { renderHtmlToPng } from "@/lib/images";
import { describeMedia, extractFrames, isServablePath, linkFile, linkIntoWorkspace, mediaDir, mediaInfo, mediaKind } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { createTask } from "@/lib/tasks";
import { syncDeliverableFile } from "@/lib/workfiles";
import { humanThread, openRequest } from "@/lib/humans";
import { onTaskFinished } from "@/lib/manager";
import { sendToHuman } from "./humans";
import { renderVideo } from "./video";

export const BIZ_SERVER = "biz";

/** Tools that act inside Ajudan only: always allowed. */
export const SAFE_BIZ_TOOLS = [
  "save_deliverable",
  "list_deliverables",
  "assign_task",
  "set_status",
  "render_image",
  "list_media",
  "inspect_media",
  "extract_frames",
  "render_video",
  "find_free_assets",
  "download_free_asset",
  "team_status",
  "task_results",
  "pending_approvals",
].map(
  (t) => `mcp__${BIZ_SERVER}__${t}`,
);
/** Talking to the team's human teammates on WhatsApp (not for draft-only teammates). */
export const HUMAN_TOOLS = ["ask_human", "message_human", "close_human_request", "human_conversation"].map((t) => `mcp__${BIZ_SERVER}__${t}`);
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
  /** Aborted when the folder closes (stops a render). */
  signal?: AbortSignal;
  /** Human teammates reachable on WhatsApp (adds ask_human & co). */
  humans?: Teammate[];
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
          .describe(
            "Images and videos that belong to this work, in order: paths returned by render_image or render_video (e.g. carousel slides, the final video), or media/… files",
          ),
      },
      async (a) => {
        const attachments = (a.images ?? []).map((p: string) => p.replace(/^\.?\//, ""));
        const missing = attachments.filter((p: string) => !isServablePath(p) || !fs.existsSync(path.join(dataDir(), p)));
        if (missing.length) {
          return fail(`Unknown file(s): ${missing.join(", ")}. Use the paths render_image or render_video returned, or media/… files.`);
        }
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
      "list_media",
      "List the business's media library: footage, photos and audio the owner uploaded (newest first). Listing makes them readable in your folder at the same path.",
      { kind: z.enum(["video", "image", "audio", "file"]).optional() },
      async (a) => {
        const dir = mediaDir();
        if (!fs.existsSync(dir)) return ok("The media library is empty. Ask the owner to drop files into the chat.");
        const files = fs
          .readdirSync(dir)
          .filter((f) => !f.startsWith(".") && (!a.kind || mediaKind(f) === a.kind))
          .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((x, y) => y.t - x.t)
          .slice(0, 40)
          .map((x) => path.join("media", x.f));
        if (!files.length) return ok("No matching files in the media library.");
        linkIntoWorkspace(files, ctx.cwd);
        const credits = readCredits();
        const lines = await Promise.all(
          files.map(async (rel) => {
            const c = credits[rel];
            const from = c ? ` (free asset: "${c.title}" by ${c.creator}, ${c.license}${c.creditRequired ? `, credit: ${c.attribution}` : ""})` : "";
            return `- ${describeMedia(rel, await mediaInfo(path.join(dataDir(), rel)))}${from}`;
          }),
        );
        return ok(lines.join("\n"));
      },
    ),

    tool(
      "inspect_media",
      "Duration, size, frame rate and whether there is sound, for a video, image or audio file (media/… or work/…).",
      { file: z.string().describe('e.g. "media/2026-10-22-unboxing-a1b2c3.mp4"') },
      async (a) => {
        const rel = a.file.replace(/^\.?\//, "");
        const abs = path.join(dataDir(), rel);
        if (!isServablePath(rel) || !fs.existsSync(abs)) return fail(`No file ${a.file}. Use paths from your task or list_media.`);
        return ok(describeMedia(rel, await mediaInfo(abs)));
      },
    ),

    tool(
      "extract_frames",
      "Take still frames from a video (owner footage or your own render) as JPGs in work/frames/, so you can Read them and see what's in it. Evenly spread by default, or at the given seconds.",
      {
        file: z.string().describe("media/… or work/videos/… video"),
        count: z.number().int().min(1).max(24).optional().describe("How many evenly spread frames (default 6)"),
        at_seconds: z.array(z.number().min(0)).max(24).optional().describe("Exact timestamps instead"),
      },
      async (a) => {
        const rel = a.file.replace(/^\.?\//, "");
        const abs = path.join(dataDir(), rel);
        if (!isServablePath(rel) || !fs.existsSync(abs)) return fail(`No file ${a.file}.`);
        if (mediaKind(rel) !== "video") return fail(`${a.file} is not a video. Read images directly.`);
        const frames = await extractFrames(abs, path.join(ctx.cwd, "work", "frames"), { count: a.count, at: a.at_seconds });
        return ok(
          `Read these to look at the video:\n${frames.map((f) => `- ${path.relative(ctx.cwd, f.file)} (at ${f.atSec}s)`).join("\n")}`,
        );
      },
    ),

    tool(
      "find_free_assets",
      "Search free music, sound effects or photos that are safe for business use (CC0, public domain or CC BY via Openverse: Jamendo, Freesound, Flickr, Wikimedia). Use it for background music and sound effects in videos. Search in English with mood/genre words (e.g. \"upbeat acoustic\", \"lofi chill\", \"whoosh\", \"pop click\"). Limited to ~200 searches a day: search with purpose.",
      {
        type: z.enum(["music", "sound_effect", "image"]),
        query: z.string().describe('Mood, genre or sound, e.g. "upbeat happy ukulele"'),
        min_seconds: z.number().min(0).optional().describe("Audio: shortest acceptable length"),
        max_seconds: z.number().min(0).optional().describe("Audio: longest acceptable length"),
        limit: z.number().int().min(1).max(20).optional(),
      },
      async (a) => {
        try {
          const found = await searchFreeAssets({
            type: a.type,
            query: a.query,
            minSeconds: a.min_seconds,
            maxSeconds: a.max_seconds,
            limit: a.limit ?? 8,
          });
          if (!found.length) return ok("Nothing found. Try broader or different words (in English).");
          return ok(`${found.map(describeAsset).join("\n")}\n\nDownload one with download_free_asset(id, type). You can't listen to tracks, so pick by title, tags, length and source, and prefer several short candidates over one guess.`);
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    ),

    tool(
      "download_free_asset",
      "Download a result of find_free_assets into the business's media library (and your folder). Returns its media/… path for staticFile() and the credit line to put in the caption if the license needs one.",
      { id: z.string().describe("The id from find_free_assets"), type: z.enum(["music", "sound_effect", "image"]) },
      async (a) => {
        try {
          const { path: rel, asset } = await downloadFreeAsset(a.id, a.type);
          linkIntoWorkspace([rel], ctx.cwd);
          ev("asset_downloaded", `${teammate.name} downloaded "${asset.title}" by ${asset.creator} (${asset.license})`, { path: rel });
          const info = await mediaInfo(path.join(dataDir(), rel));
          return ok(
            `Saved ${describeMedia(rel, info)}. Use staticFile("${rel}").${
              asset.creditRequired
                ? ` License ${asset.license}: credit is required. Put this in the caption or posting notes: 🎵 "${asset.title}" by ${asset.creator} (${asset.license})${asset.pageUrl ? ` ${asset.pageUrl}` : ""}`
                : ` License ${asset.license}: no credit needed (a credit is still nice).`
            }`,
          );
        } catch (err) {
          return fail(`Download failed: ${(err as Error).message}`);
        }
      },
    ),

    tool(
      "render_video",
      "Render your Remotion video to MP4. The file (a .tsx in your folder, usually work/video/<name>/Video.tsx) must `export const video = { width, height, fps, durationInFrames }` and default-export the component. Use staticFile(\"media/…\") for the owner's footage. Takes a minute or more. Returns the path to attach, or the build or render error to fix.",
      {
        file: z.string().describe('e.g. "work/video/promo-nama/Video.tsx"'),
        name: z.string().describe('Output name, e.g. "promo-nama-tiktok"'),
      },
      async (a) => {
        const source = path.resolve(ctx.cwd, a.file);
        if (!source.startsWith(ctx.cwd + path.sep) || !/\.tsx?$/.test(source) || !fs.existsSync(source)) {
          return fail(`No .tsx file ${a.file} in your folder.`);
        }
        const file = `${new Date().toISOString().slice(0, 10)}-${slugify(a.name)}-${taskId.slice(0, 4)}.mp4`;
        const inWorkspace = path.join(ctx.cwd, "work", "videos", file);
        let shown = -1;
        const setActivity = (text: string) =>
          db.update(schema.teammates).set({ currentActivity: text }).where(eq(schema.teammates.id, teammate.id)).run();
        setActivity("Rendering video…");
        try {
          const r = await renderVideo({
            source,
            outPath: inWorkspace,
            workDir: path.join(ctx.cwd, "work", ".render", taskId.slice(0, 8)),
            signal: ctx.signal,
            onProgress: (p) => {
              const pct = Math.floor(p * 10) * 10;
              if (pct !== shown) {
                shown = pct;
                setActivity(`Rendering video ${pct}%`);
              }
            },
          });
          const rel = path.join("work", "videos", file);
          linkFile(inWorkspace, path.join(dataDir(), rel));
          ev("video_rendered", `${teammate.name} rendered ${file}`, { path: rel });
          const info = await mediaInfo(inWorkspace);
          return ok(
            `Rendered ${describeMedia(rel, info)} (${r.width}×${r.height}, ${r.fps} fps). Check it with extract_frames("${rel}") and Read the frames. Attach it as "${rel}".`,
          );
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          return fail(`Render failed. Fix ${a.file} and try again:\n${msg.slice(0, 4000)}`);
        }
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
          files: z
            .array(z.string())
            .optional()
            .describe("Files they need (the owner's footage and photos from your task, media/… or work/… paths)"),
        },
        async (a) => {
          const target = ctx.roster.find((r) => r.name.toLowerCase() === a.teammate_name.trim().toLowerCase());
          if (!target) {
            if (a.teammate_name.trim().toLowerCase() === teammate.name.toLowerCase())
              return fail("You can't assign a task to yourself; just do the work.");
            return fail(`No teammate named "${a.teammate_name}". Available: ${ctx.roster.map((r) => r.name).join(", ")}.`);
          }
          const files = (a.files ?? []).map((f: string) => f.replace(/^\.?\//, ""));
          const unknown = files.filter((f: string) => !isServablePath(f) || !fs.existsSync(path.join(dataDir(), f)));
          if (unknown.length) return fail(`Unknown file(s): ${unknown.join(", ")}. Use media/… or work/… paths.`);
          const task = createTask({
            businessId,
            teammateId: target.id,
            instructions: a.instructions,
            attachments: files,
            createdBy: `teammate:${teammate.id}`,
            // The manager's report-back waits for everything delegated from this task.
            parentTaskId: ctx.isManager ? taskId : null,
          });
          ev("delegated", `${teammate.name} asked ${target.name}: ${task.title}`, {
            from: teammate.id,
            to: target.id,
            delegatedTaskId: task.id,
          });
          return ok(
            `Assigned to ${target.name} (task ${task.id})${files.length ? ` with ${files.length} file(s)` : ""}. They'll work on it after you; check later with list_deliverables.`,
          );
        },
      ),
    );
  }

  if (ctx.humans?.length) {
    const humans = ctx.humans;
    const find = (name: string) => humans.find((h) => h.name.toLowerCase() === name.trim().toLowerCase());
    const unknown = (name: string) => fail(`No human teammate named "${name}". Human teammates: ${humans.map((h) => h.name).join(", ")}.`);
    const business = () => db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()!;
    const cleanFiles = (files?: string[]) => (files ?? []).map((f) => f.replace(/^\.?\//, ""));
    const badFiles = (files: string[]) => files.filter((f) => !isServablePath(f) || !fs.existsSync(path.join(dataDir(), f)));
    tools.push(
      tool(
        "ask_human",
        `Ask a human teammate for something by WhatsApp (footage, photos, a fact, a check, a physical task). Human teammates: ${humans.map((h) => `${h.name} (${h.title}${h.responsibilities.length ? `: ${h.responsibilities.join("; ")}` : ""})`).join(", ")}. The message is sent as is from the business's WhatsApp, with a line saying it's from you (an AI). Their reply comes back to you later as a new task, with any photos and videos attached. Don't wait for it: finish your current work and say what you asked for.`,
        {
          name: z.string().describe("The human teammate's name"),
          message: z
            .string()
            .describe("The WhatsApp message to them, in the business's language: friendly, short, specific (a numbered shot list for footage), with a deadline if there is one"),
          files: z.array(z.string()).optional().describe("Files to send them (media/… or work/…), e.g. a reference image"),
        },
        async (a) => {
          const h = find(a.name);
          if (!h) return unknown(a.name);
          const files = cleanFiles(a.files);
          if (badFiles(files).length) return fail(`Unknown file(s): ${badFiles(files).join(", ")}.`);
          const task = createTask({
            businessId,
            teammateId: h.id,
            instructions: a.message,
            createdBy: `teammate:${teammate.id}`,
            // The reply finds its way back to this task's teammate (worker/humans.ts).
            parentTaskId: taskId,
            attachments: files,
          });
          ev("delegated", `${teammate.name} asked ${h.name} (WhatsApp): ${task.title}`, { from: teammate.id, to: h.id, delegatedTaskId: task.id });
          return ok(`Sending to ${h.name} on WhatsApp now. Their reply will come back to you as a new task. Finish what you can without it, and tell the owner you're waiting on ${h.name}.`);
        },
      ),
      tool(
        "message_human",
        "Send a WhatsApp message (and optionally files, e.g. a draft video to check) to a human teammate in an ongoing conversation: a thank-you, a follow-up question, feedback on what they sent. Use ask_human for a new request.",
        {
          name: z.string(),
          message: z.string().describe("The WhatsApp message, in the business's language"),
          files: z.array(z.string()).optional().describe("media/… or work/… files to send"),
        },
        async (a) => {
          const h = find(a.name);
          if (!h) return unknown(a.name);
          const files = cleanFiles(a.files);
          if (badFiles(files).length) return fail(`Unknown file(s): ${badFiles(files).join(", ")}.`);
          try {
            await sendToHuman({ business: business(), human: h, from: teammate, text: a.message, files, taskId: openRequest(h.id)?.id ?? null });
          } catch (err) {
            return fail(`Couldn't send on WhatsApp: ${(err as Error).message}`);
          }
          return ok(`Sent to ${h.name}.`);
        },
      ),
      tool(
        "close_human_request",
        "Mark a human teammate's open request as done (you got what you needed), with a short note. Replies after that go to the manager.",
        { name: z.string(), note: z.string().describe("What you got, e.g. \"3 clips of the printer\"") },
        async (a) => {
          const h = find(a.name);
          if (!h) return unknown(a.name);
          const req = openRequest(h.id);
          if (!req) return ok(`${h.name} has no open request.`);
          db.update(schema.tasks).set({ status: "done", result: a.note, finishedAt: new Date() }).where(eq(schema.tasks.id, req.id)).run();
          const more = openRequest(h.id);
          db.update(schema.teammates)
            .set({ state: more ? "waiting" : "idle", currentActivity: more ? `Asked on WhatsApp: ${more.title}`.slice(0, 140) : null })
            .where(eq(schema.teammates.id, h.id))
            .run();
          ev("human_request_done", `${teammate.name} closed the request to ${h.name}: ${a.note}`, { humanId: h.id });
          onTaskFinished(req.id);
          return ok(`Closed "${req.title}".`);
        },
      ),
      tool(
        "human_conversation",
        "Read the recent WhatsApp conversation with a human teammate (requests, their replies, file paths).",
        { name: z.string() },
        async (a) => {
          const h = find(a.name);
          if (!h) return unknown(a.name);
          return ok(humanThread(h.id, 30) || `No messages with ${h.name} yet.`);
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
          .where(and(eq(schema.tasks.businessId, businessId), inArray(schema.tasks.status, ["queued", "running", "waiting_approval", "waiting_human"])))
          .all();
        const lines = mates().map((m) => {
          const mine = open.filter((t) => t.teammateId === m.id).map((t) => `${t.title} (${t.status.replace("_", " ")})`);
          if (m.kind === "human") {
            return `- ${m.name}, ${m.title}: HUMAN teammate, reached on WhatsApp with ask_human${mine.length ? `; open requests: ${mine.join("; ")}` : ""}`;
          }
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
