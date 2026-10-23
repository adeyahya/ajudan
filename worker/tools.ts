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
import { assetRows, describeOrganization, organize } from "@/lib/assets";
import { CONTACT_KINDS, describeContact, listContacts, searchAddressBook, upsertContact } from "@/lib/contacts";
import { applyPageEdit, createSuggestion, findPage, listPageHeads, listPages, pageForAgents, pagesById, pendingSuggestions, readablePage, readerMode, readerRows, recordFetch, searchPages } from "@/lib/context";
import { describeMedia, extractFrames, isServablePath, linkFile, linkIntoWorkspace, mediaDir, mediaInfo, mediaKind } from "@/lib/media";
import { dataDir } from "@/lib/paths";
import { createTask, delegatedInstructions, delegationDepth, deriveTaskTitle, MAX_DELEGATION_DEPTH, ownerRequest } from "@/lib/tasks";
import { describeDeliverable, reviseDeliverable } from "@/lib/deliverables";
import { queueRevision } from "@/lib/feedback";
import { syncDeliverableFile } from "@/lib/workfiles";
import { humanThread, openRequest } from "@/lib/humans";
import { activeWatches, describeWatch } from "@/lib/watches";
import { requestCapability, type CapabilityRequest } from "@/lib/capabilities";
import { canTeamEdit, EDIT_AREAS, editOffMessage } from "@/lib/team-edits";
import { matchIds } from "@/lib/search";
import { PLACEHOLDER, findSecret, hostAllowed, listSecrets, normalizeHost, redact, secretValue } from "@/lib/secrets";
import { onTaskFinished, REVISION } from "@/lib/manager";
import { sendToHuman } from "./humans";
import { notifyOwner } from "./owner-approvals";
import { speechAvailable, transcribe } from "@/lib/speech";
import { renderVideo } from "./video";
import { fileInside } from "./fs-guard";
import { isPrivateHost } from "@/lib/net";

export const BIZ_SERVER = "biz";

/** Tools that act inside Ajudan only: always allowed. */
export const SAFE_BIZ_TOOLS = [
  "save_deliverable",
  "mark_ready_to_post",
  "draft_outbound_message",
  "list_deliverables",
  "read_deliverable",
  "update_deliverable",
  "request_revision",
  "assign_task",
  "set_status",
  "render_image",
  "list_media",
  "search_contacts",
  "save_contact",
  "organize_media",
  "inspect_media",
  "extract_frames",
  "render_video",
  "find_free_assets",
  "download_free_asset",
  "request_capability",
  "list_secrets",
  "transcribe_media",
  "team_status",
  "task_results",
  "pending_approvals",
  "search_context",
  "read_page",
  "suggest_page_edit",
].map(
  (t) => `mcp__${BIZ_SERVER}__${t}`,
);
/** Talking to the team's human teammates on WhatsApp (not for draft-only teammates). */
export const HUMAN_TOOLS = ["ask_human", "message_human", "close_human_request", "human_conversation"].map((t) => `mcp__${BIZ_SERVER}__${t}`);
/** Allowed for GET/HEAD; other methods change things and are gated like publishing (worker/handlers/task.ts). */
export const HTTP_TOOL = `mcp__${BIZ_SERVER}__http_request`;
/**
 * Tools that reach the outside world: gated by the teammate's autonomy. Ajudan can't post
 * anywhere itself (mark_ready_to_post and draft_outbound_message only prepare work for the
 * owner); the browser and WhatsApp (worker/whatsapp-tools.ts) are the real outward channels.
 */
export const OUTWARD_BIZ_TOOLS = ["confirm_browser_action"].map((t) => `mcp__${BIZ_SERVER}__${t}`);

export type BizContext = {
  businessId: string;
  teammate: Pick<Teammate, "id" | "name" | "title" | "roleKey">;
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
  /**
   * The manager's first report on a request (canReview in src/lib/manager.ts): the
   * owner's request it may send work back for, once (adds request_revision).
   */
  reviewRequestId?: string | null;
};

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

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
      "List the business's media library: footage, photos and audio the owner uploaded, with how the owner organized them (★ picks, titles, albums, #tags and notes on how to use them). Starred first, then newest. Listing makes them readable in your folder at the same path. Follow the owner's notes.",
      {
        kind: z.enum(["video", "image", "audio", "file"]).optional(),
        album: z.string().optional().describe("Only this album"),
        tag: z.string().optional().describe("Only files with this tag"),
        starred: z.boolean().optional().describe("Only the owner's starred picks"),
      },
      async (a) => {
        const dir = mediaDir();
        if (!fs.existsSync(dir)) return ok("The media library is empty. Ask the owner to drop files into the chat.");
        const all = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isFile() && !d.name.startsWith(".") && (!a.kind || mediaKind(d.name) === a.kind))
          .map((d) => ({ rel: path.join("media", d.name), t: fs.statSync(path.join(dir, d.name)).mtimeMs }));
        const org = assetRows(ctx.businessId, all.map((x) => x.rel));
        const tag = a.tag?.trim().toLowerCase().replace(/^#/, "");
        const files = all
          .filter((x) => {
            const o = org.get(x.rel);
            if (a.starred && !o?.starred) return false;
            if (a.album && o?.album?.toLowerCase() !== a.album.trim().toLowerCase()) return false;
            if (tag && !o?.tags.includes(tag)) return false;
            return true;
          })
          .sort((x, y) => Number(!!org.get(y.rel)?.starred) - Number(!!org.get(x.rel)?.starred) || y.t - x.t)
          .slice(0, 40)
          .map((x) => x.rel);
        if (!files.length) return ok("No matching files in the media library.");
        linkIntoWorkspace(files, ctx.cwd);
        const credits = readCredits();
        const lines = await Promise.all(
          files.map(async (rel) => {
            const c = credits[rel];
            const from = c ? ` (free asset: "${c.title}" by ${c.creator}, ${c.license}${c.creditRequired ? `, credit: ${c.attribution}` : ""})` : "";
            const owner = describeOrganization(org.get(rel));
            return `- ${describeMedia(rel, await mediaInfo(path.join(dataDir(), rel)))}${from}${owner ? ` ${owner}` : ""}`;
          }),
        );
        return ok(lines.join("\n"));
      },
    ),

    tool(
      "organize_media",
      "Organize files in the media library the way the owner does in Studio: a title, a note on how to use it, tags, an album, a star for the best picks. Pass only what changes (add_tags adds to the tags; tags replaces them). Only works when the owner lets the team organize the library.",
      {
        files: z.array(z.string()).describe('Library paths from list_media, e.g. ["media/2026-10-22-unboxing-a1b2c3.mp4"]'),
        title: z.string().optional(),
        note: z.string().optional().describe("How to use it, e.g. \"good opener, sound is noisy after 0:12\""),
        add_tags: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional().describe("Replace the tags with these"),
        album: z.string().optional().describe('Empty string takes it out of its album'),
        starred: z.boolean().optional(),
      },
      async (a) => {
        if (!canTeamEdit(businessId, "library")) return fail(editOffMessage("library"));
        const files = a.files.map((f: string) => f.replace(/^\.?\//, ""));
        const n = organize(businessId, files, { title: a.title, note: a.note, tags: a.tags, album: a.album, starred: a.starred }, a.add_tags ?? []);
        if (!n) return fail(`None of these are in the media library: ${files.join(", ")}. Use paths from list_media.`);
        ev("media_organized", `${teammate.name} organized ${n} file${n === 1 ? "" : "s"} in the library`, { files });
        return ok(`Organized ${n} of ${files.length} file(s).`);
      },
    ),

    tool(
      "search_contacts",
      "Look people up in the business's address book that the owner keeps: customers, suppliers, partners, with phone, email, company, tags and the owner's notes about them. Words must all match (name, company, tag, notes…); empty query lists everyone.",
      {
        query: z.string().describe('e.g. "Rina", "reseller", "#vip", "kertas supplier"'),
        kind: z.enum(["customer", "supplier", "partner", "team", "other"]).optional(),
      },
      async (a) => {
        const found = searchAddressBook(ctx.businessId, a.query, a.kind, 30);
        if (!found.length) return ok(`Nobody in the address book matches.${canTeamEdit(ctx.businessId, "contacts") ? " Add someone with save_contact." : ""}`);
        return ok(found.map(describeContact).join("\n"));
      },
    ),

    tool(
      "save_contact",
      "Add a person to the business's address book, or update someone already in it (matched by id, phone, then exact name). Pass only what you know or what changed: tags are added, notes appended, other fields kept. Use it when you learn a customer's, supplier's or partner's details (name, WhatsApp number, email, company, what they want). Only works when the owner lets the team manage contacts.",
      {
        name: z.string().optional().describe("Full name as people know them, e.g. \"Bu Rina\" (needed for someone new)"),
        id: z.string().optional().describe("An existing contact's id, to update that one"),
        phone: z.string().optional().describe("With country code, e.g. \"+62 812 3456 7890\""),
        email: z.string().optional(),
        company: z.string().optional(),
        kind: z.enum(Object.keys(CONTACT_KINDS) as [string, ...string[]]).optional(),
        tags: z.array(z.string()).optional().describe('e.g. ["reseller", "jakarta"]'),
        notes: z.string().optional().describe("What's useful to remember about them, with the date if it's news"),
      },
      async (a) => {
        if (!canTeamEdit(ctx.businessId, "contacts")) return fail(editOffMessage("contacts"));
        if (!a.id && !a.name?.trim() && !a.phone?.trim()) return fail("Say who: a name (or a phone number, or the id of someone already there).");
        const r = upsertContact(ctx.businessId, a, `teammate:${teammate.id}`);
        if ("error" in r) return fail(r.error ?? "Couldn't save the contact.");
        ev("contact_saved", `${teammate.name} ${r.created ? "added" : "updated"} the contact ${r.contact.name}`, { contactId: r.contact.id });
        return ok(`${r.created ? "Added" : "Updated"} (id ${r.contact.id}):\n${describeContact(r.contact)}`);
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
      "transcribe_media",
      "Turn speech in a video or audio file (media/… or work/…) into text, on this Mac: what someone says in footage, a voice note, an interview. With captions=true it also writes timed captions (.srt next to the file) for subtitles in a video (parse with @remotion/captions parseSrt). Names and numbers can be misheard.",
      {
        file: z.string().describe('e.g. "media/2026-10-22-unboxing-a1b2c3.mp4"'),
        captions: z.boolean().optional().describe("Also write timed captions (.srt)"),
        language: z.string().optional().describe('Spoken language code, e.g. "id" or "en" (default: the business language)'),
      },
      async (a) => {
        const rel = a.file.replace(/^\.?\//, "");
        const abs = path.join(dataDir(), rel);
        if (!isServablePath(rel) || !fs.existsSync(abs)) return fail(`No file ${a.file}.`);
        if (!["audio", "video"].includes(mediaKind(rel))) return fail(`${a.file} isn't audio or video.`);
        if (!speechAvailable()) return fail("Speech recognition isn't set up on this Mac yet.");
        const language = a.language ?? db.select({ l: schema.businesses.language }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.l;
        try {
          const t = await transcribe(abs, { language, srtNextTo: a.captions, signal: ctx.signal });
          if (!t.text) return ok("No speech found in that file.");
          const srt = t.srt ? path.relative(dataDir(), t.srt) : null;
          if (srt) linkIntoWorkspace([srt], ctx.cwd);
          const timed = t.segments.slice(0, 80).map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}s] ${s.text}`).join("\n");
          return ok(`Language: ${t.language}\n\n${t.text}${srt ? `\n\nCaptions saved: ${srt} (staticFile("${srt}"))` : ""}\n\nTimed:\n${timed}`);
        } catch (err) {
          return fail(`Couldn't transcribe: ${(err as Error).message.slice(0, 500)}`);
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
        // Real path: a symlink to a .tsx elsewhere would otherwise bundle from outside the folder.
        const source = /\.tsx?$/.test(a.file) ? fileInside(ctx.cwd, a.file) : null;
        if (!source) return fail(`No .tsx file ${a.file} in your folder.`);
        const file = `${new Date().toISOString().slice(0, 10)}-${slugify(a.name)}-${taskId.slice(0, 4)}.mp4`;
        const inWorkspace = path.join(ctx.cwd, "work", "videos", file);
        let shown = -1;
        const setActivity = (text: string) =>
          db.update(schema.teammates).set({ currentActivity: text }).where(eq(schema.teammates.id, teammate.id)).run();
        setActivity("Rendering video…");
        try {
          const r = await renderVideo({
            source,
            cwd: ctx.cwd,
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
      { status: z.enum(["draft", "ready_to_post", "approved", "published", "rejected"]).optional() },
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
      "read_deliverable",
      "Read a saved deliverable in full (yours or a teammate's): title, kind, status, version, content and its attached images and videos, which become readable in your folder at the same paths. Use it to review work or before revising it.",
      { deliverable_id: z.string() },
      async (a) => {
        const d = db
          .select()
          .from(schema.deliverables)
          .where(and(eq(schema.deliverables.id, a.deliverable_id), eq(schema.deliverables.businessId, businessId)))
          .get();
        if (!d) return fail(`No deliverable with id ${a.deliverable_id} in this business. list_deliverables shows the ids.`);
        const maker = d.teammateId ? db.select({ name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.id, d.teammateId)).get() : undefined;
        linkIntoWorkspace(d.attachments, ctx.cwd);
        return ok(`${describeDeliverable(d, maker?.name)}${d.attachments.length ? "\n\n(Read the images at the paths above; use extract_frames for videos.)" : ""}`);
      },
    ),

    tool(
      "update_deliverable",
      "Revise a saved deliverable in place: new content, title or attachments. The previous version is kept, the id stays the same (feedback and the Work page stay attached), and it goes back to draft for the owner to look at again. Use this for revisions instead of saving a new deliverable. Pass only what changes.",
      {
        deliverable_id: z.string(),
        content: z.string().optional().describe("The full new content (not a diff)"),
        title: z.string().optional(),
        images: z
          .array(z.string())
          .optional()
          .describe("The full new list of images and videos, in order (render_image / render_video paths or media/… files); omit to keep the current ones"),
      },
      async (a) => {
        const attachments = a.images?.map((p: string) => p.replace(/^\.?\//, ""));
        const missing = (attachments ?? []).filter((p: string) => !isServablePath(p) || !fs.existsSync(path.join(dataDir(), p)));
        if (missing.length) {
          return fail(`Unknown file(s): ${missing.join(", ")}. Use the paths render_image or render_video returned, or media/… files.`);
        }
        const r = reviseDeliverable({
          businessId,
          deliverableId: a.deliverable_id,
          by: teammate,
          taskId,
          title: a.title,
          content: a.content,
          attachments,
        });
        if (!r.ok) return fail(r.error);
        return ok(
          `Updated "${r.deliverable.title}" (now version ${r.deliverable.versions.length + 1}; the previous one is kept). It's a draft again: mark_ready_to_post when it's ready for the owner.`,
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
      "mark_ready_to_post",
      "Mark a saved deliverable as finished and ready for the owner to post on a channel. Ajudan doesn't post it: the owner copies the text and files from the Work page and posts it themselves. Use the deliverable_id returned by save_deliverable.",
      {
        deliverable_id: z.string(),
        channel: z.string().describe('Where the owner should post it, e.g. "instagram", "blog", "newsletter"'),
      },
      async (a) => {
        const d = db
          .select()
          .from(schema.deliverables)
          .where(and(eq(schema.deliverables.id, a.deliverable_id), eq(schema.deliverables.businessId, businessId)))
          .get();
        if (!d) return fail(`No deliverable with id ${a.deliverable_id} in this business.`);
        db.update(schema.deliverables)
          .set({ status: "ready_to_post", channel: a.channel })
          .where(eq(schema.deliverables.id, d.id))
          .run();
        syncDeliverableFile(d.id);
        ev("deliverable_ready", `${teammate.name} finished "${d.title}" for the owner to post on ${a.channel}`, {
          deliverableId: d.id,
          channel: a.channel,
        });
        return ok(
          `"${d.title}" is marked ready to post on ${a.channel}. Nothing was posted: the owner posts it from the Work page. Say so in your summary.`,
        );
      },
    ),

    tool(
      "draft_outbound_message",
      "Write a message (email, DM, outreach) for the owner to send to someone outside the business. Ajudan doesn't send it: it's saved as ready to send and the owner copies it from the Work page.",
      {
        channel: z.string().describe('e.g. "email", "instagram_dm", "linkedin"'),
        to: z.string().describe("Recipient (name, handle or address)"),
        subject: z.string().describe("Subject or short headline"),
        body: z.string().describe("Full message body, exactly as it should be sent"),
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
            status: "ready_to_post",
          })
          .returning({ id: schema.deliverables.id })
          .get();
        syncDeliverableFile(d.id);
        ev("message_drafted", `${teammate.name} drafted a ${a.channel} message to ${a.to} for the owner to send`, {
          deliverableId: d.id,
        });
        return ok(
          `Message to ${a.to} saved as ready to send (id ${d.id}). Nothing was sent: the owner sends it from the Work page. Say so in your summary.`,
        );
      },
    ),

    // The Context workspace (src/lib/context.ts): read freely, never write; suggest.
    tool(
      "search_context",
      "Search the owner's Context pages (business facts, products, policies, how we work, what the team learned) and the address book for a fact. Returns the best matching pages with a snippet; read_page for the whole page.",
      { query: z.string().describe('e.g. "ongkir gratis jawa", "reseller discount", "Bu Rina"') },
      async (a) => {
        const heads = listPageHeads(businessId);
        const rows = readerRows(businessId);
        const shared = heads.filter((p) => p.kind !== "database" && readerMode(p, teammate.id, rows) !== "never");
        // The index finds the candidates (src/lib/search.ts); searchPages ranks them and cuts snippets.
        const ids = matchIds("context_pages", businessId, a.query.split(/[^\p{L}\p{N}]+/u));
        const sharedIds = new Set(shared.map((p) => p.id));
        const hits = searchPages(pagesById(businessId, (ids ?? [...sharedIds]).filter((id) => sharedIds.has(id))), a.query);
        const people = searchAddressBook(businessId, a.query, undefined, 5);
        const contacts = heads.find((p) => p.source === "contacts");
        if (!hits.length && !people.length) return ok(`Nothing matches "${a.query}". Pages: ${shared.map((p) => `"${p.title}"`).join(", ") || "none"}.`);
        return ok(
          [
            ...hits.map((h) => `- "${h.title}" (id ${h.id}): ${h.snippet}`),
            ...(people.length ? [`\nPeople${contacts ? ` ("${contacts.title}")` : ""}:`, ...people.map(describeContact)] : []),
          ].join("\n"),
        );
      },
    ),

    tool(
      "read_page",
      "Read one of the owner's Context pages in full, by title or id (the pages listed in your instructions). When you use what it says, cite the page title.",
      { page: z.string().describe('Title or id, e.g. "Rules & policies"') },
      async (a) => {
        const r = readablePage(businessId, teammate.id, a.page);
        if ("error" in r) return fail(r.error ?? "Not found.");
        const p = r.page;
        let body = pageForAgents(p);
        if (p.source === "contacts") {
          const all = listContacts(businessId);
          body = `${all.length} people in the address book${all.length > 80 ? " (first 80; search_contacts finds the rest)" : ""}:\n${all.slice(0, 80).map(describeContact).join("\n")}`;
        }
        const text = `# ${p.title}\n${p.updatedAt ? `(last changed ${p.updatedAt.toISOString().slice(0, 10)})\n` : ""}\n${body.slice(0, 30_000) || "(empty page)"}`;
        recordFetch(businessId, taskId, teammate.id, p, text.length);
        return ok(text);
      },
    ),

    tool(
      "suggest_page_edit",
      "Change the owner's Context pages when you learn something durable that's missing or out of date there (a new price or policy, a customer preference, a lesson). Usually it's a proposal: the owner sees exactly what you propose, with your reason and source, and accepts or rejects it. If the owner lets the team edit pages directly, it's applied straight away (and kept in the page's history with your reason). Prefer a short append to the right page; replace only to fix what's wrong, keeping everything else. A mind map page is a nested bullet list: suggest ideas as \"- \" bullets, indented two spaces under the idea they branch from.",
      {
        page: z.string().optional().describe("Title or id of the page to change (omit for a new page)"),
        mode: z.enum(["append", "replace", "new_page"]).describe("append: add markdown at the end; replace: the whole page's new markdown; new_page: a new page"),
        markdown: z.string().describe("The text to add, the full new page, or the new page's content, as markdown"),
        reason: z.string().describe("Why, in one line"),
        source: z.string().describe('Where it comes from, e.g. "The owner in chat, 23 Oct: \'from next month free shipping in Java above 100k\'"'),
        title: z.string().optional().describe("new_page: its title"),
        section: z.enum(["business", "product", "people", "how_we_work", "team_written"]).optional().describe("new_page: where it goes (default team_written)"),
      },
      async (a) => {
        if (!a.markdown.trim()) return fail("Nothing to suggest: markdown is empty.");
        const direct = canTeamEdit(businessId, "context");
        if (a.mode === "new_page") {
          if (!a.title?.trim()) return fail("A new page needs a title.");
          const same = findPage(businessId, a.title);
          if (same && same.title.toLowerCase() === a.title.trim().toLowerCase()) return fail(`"${same.title}" already exists: suggest an append to it instead.`);
          if (direct) {
            const page = applyPageEdit({ businessId, teammate, taskId, kind: "new_page", body: a.markdown, title: a.title.trim(), section: a.section ?? "team_written", reason: a.reason, source: a.source });
            return ok(`Added the page "${page?.title}" (the owner lets the team edit pages directly).`);
          }
          const s = createSuggestion({ businessId, teammate, taskId, kind: "new_page", body: a.markdown, title: a.title.trim(), section: a.section ?? "team_written", reason: a.reason, source: a.source });
          return ok(`Suggested the new page "${a.title}" (suggestion ${s.id}). It exists only once the owner accepts it; they see it in Context${ctx.isManager ? " and as a card under your reply in this chat: tell them in one line what you proposed" : ""}.`);
        }
        if (!a.page) return fail("Say which page (title or id), or use mode new_page.");
        const page = findPage(businessId, a.page);
        if (!page) return fail(`No page "${a.page}". Pages: ${listPages(businessId).map((p) => `"${p.title}"`).join(", ")}.`);
        if (page.kind === "database") return fail(`"${page.title}" is the address book, not a text page. Mention the change in your summary for the owner instead.`);
        const dup = pendingSuggestions(businessId, page.id).find((s) => s.kind === a.mode && s.body.trim() === a.markdown.trim());
        if (dup) return ok(`Already suggested (suggestion ${dup.id}); the owner hasn't decided yet.`);
        if (direct) {
          applyPageEdit({ businessId, teammate, taskId, page, kind: a.mode, body: a.markdown, reason: a.reason, source: a.source });
          return ok(`${a.mode === "append" ? "Added to" : "Rewrote"} "${page.title}" (the owner lets the team edit pages directly; it's in the page's history).`);
        }
        const s = createSuggestion({ businessId, teammate, taskId, page, kind: a.mode, body: a.markdown, reason: a.reason, source: a.source });
        return ok(`Suggested ${a.mode === "append" ? "an addition to" : "a new version of"} "${page.title}" (suggestion ${s.id}). It isn't on the page until the owner accepts it${ctx.isManager ? "; they see it as a card under your reply in this chat: say in one line what you proposed to save" : ""}.`);
      },
    ),
  ];

  tools.push(
    tool(
      "http_request",
      "Call a web API (JSON, CSV…), e.g. the business's own API. Put credentials in as {{secret.NAME}} (see list_secrets): Ajudan fills them in, only for the hosts that secret allows, and never shows you the value. GET and HEAD run right away; POST, PUT, PATCH and DELETE change things and follow your freedom setting (the owner may have to approve). Big responses are saved to a file you can Read.",
      {
        url: z.string().describe('Full https URL, e.g. "https://orucraft.com/api/agent/v1/orders?month=2026-10"'),
        method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).optional(),
        headers: z.record(z.string(), z.string()).optional().describe('e.g. {"Authorization": "Bearer {{secret.ORUCRAFT_API}}"}'),
        body: z.string().optional().describe("Request body (JSON as a string)"),
        save_as: z.string().optional().describe('File name to save the response under work/api/, e.g. "orders-oktober.json"'),
      },
      async (a) => {
        const method = a.method ?? "GET";
        // Which secrets does the request use?
        const used = new Set<string>();
        const scan = (v: string) => {
          for (const m of v.matchAll(PLACEHOLDER)) used.add(m[1]);
        };
        scan(a.url);
        Object.values(a.headers ?? {}).forEach((v) => scan(String(v)));
        if (a.body) scan(a.body);
        let url: URL;
        try {
          url = new URL(a.url.replace(PLACEHOLDER, "x"));
        } catch {
          return fail(`Not a valid URL: ${a.url}`);
        }
        if (url.protocol !== "https:") return fail("Only https:// URLs.");
        // This laptop and its networks (the app's own API, Chrome's debugging port, the router) are off limits.
        if (isPrivateHost(url.hostname)) return fail(`${url.hostname} is a local or private address; http_request only reaches public hosts.`);
        const values = new Map<string, string>();
        for (const name of used) {
          const meta = findSecret(businessId, name);
          if (!meta) return fail(`There's no secret ${name}. Ask the owner for it with request_capability(kind "secret").`);
          if (!hostAllowed(url.hostname, meta.hosts)) {
            return fail(`${name} may only be sent to ${meta.hosts.join(", ")}, not ${url.hostname}.`);
          }
          const v = await secretValue(businessId, name);
          if (!v) return fail(`${name} has no value stored. Ask the owner to set it again on the Business page.`);
          values.set(name, v);
        }
        const fill = (v: string) => v.replace(PLACEHOLDER, (_m, n: string) => values.get(n) ?? "");
        let res: Response;
        try {
          res = await fetch(fill(a.url), {
            method,
            headers: Object.fromEntries(Object.entries(a.headers ?? {}).map(([k, v]) => [k, fill(String(v))])),
            body: a.body && method !== "GET" && method !== "HEAD" ? fill(a.body) : undefined,
            signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(ctx.signal ? [ctx.signal] : [])]),
            redirect: "manual",
          });
        } catch (err) {
          return fail(redact(`Request failed: ${(err as Error).message}`, values));
        }
        for (const name of used) {
          db.update(schema.secrets)
            .set({ lastUsedAt: new Date() })
            .where(and(eq(schema.secrets.businessId, businessId), eq(schema.secrets.name, name)))
            .run();
        }
        const location = res.headers.get("location");
        const text = redact(method === "HEAD" ? "" : await res.text(), values);
        const type = res.headers.get("content-type") ?? "";
        ev("tool", `${teammate.name} called ${url.hostname}${url.pathname.slice(0, 40)}`, { status: res.status });
        let saved = "";
        if (a.save_as || text.length > 12_000) {
          const ext = type.includes("json") ? ".json" : type.includes("csv") ? ".csv" : ".txt";
          const name = slugify((a.save_as ?? `${url.hostname}-${url.pathname}`).replace(/\.[a-z]+$/i, "")) + ext;
          const file = path.join(ctx.cwd, "work", "api", `${new Date().toISOString().slice(0, 10)}-${name}`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, text);
          saved = `\nSaved the full response (${text.length} chars) to ${path.relative(ctx.cwd, file)}.`;
        }
        return ok(
          `HTTP ${res.status} ${res.statusText}${location ? ` → ${redact(location, values)}` : ""} (${type || "no content type"})${saved}\n\n${text.slice(0, 6000)}${text.length > 6000 ? "\n… (truncated)" : ""}`,
        );
      },
    ),

    tool("list_secrets", "List the credentials the owner stored for the team (names and the hosts each may be sent to; never the values).", {}, async () => {
      const rows = listSecrets(businessId);
      return ok(
        rows.length
          ? rows.map((r) => `- {{secret.${r.name}}}: for ${r.hosts.join(", ")}${r.note ? ` (${r.note})` : ""}`).join("\n")
          : "No credentials stored yet. Ask for one with request_capability(kind \"secret\").",
      );
    }),

    tool(
      "request_capability",
      "Ask the owner for an ability you're missing instead of giving up: a credential (API key, token) for an API, running commands in a sandboxed shell, letting your shell reach a domain, the business browser or a site in it, WhatsApp, the connected code repositories and their GitHub issues, or letting the team change something itself (edit: contacts, Context pages, or the media library). The owner sees it on the Approvals page; if they approve, you get a new task to carry on. Never ask the owner to paste credentials into the chat: request a secret instead.",
      {
        kind: z.enum(["secret", "shell", "domain", "browser", "browser_site", "whatsapp", "repos", "edit"]),
        why: z.string().describe("One sentence for the owner: what you'll do with it"),
        name: z.string().optional().describe('secret: a name like "ORUCRAFT_API"'),
        hosts: z.array(z.string()).optional().describe('secret: the hosts it may be sent to, e.g. ["orucraft.com"]'),
        domain: z.string().optional().describe('domain: e.g. "api.orucraft.com"'),
        site: z.string().optional().describe('browser_site: e.g. "seller.shopee.co.id"'),
        area: z.enum(EDIT_AREAS).optional().describe("edit: contacts, context or library"),
      },
      async (a) => {
        let request: CapabilityRequest;
        switch (a.kind) {
          case "secret": {
            const name = (a.name ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
            const hosts = (a.hosts ?? []).map(normalizeHost).filter((h): h is string => !!h);
            if (!/^[A-Z][A-Z0-9_]{1,47}$/.test(name) || !hosts.length) return fail("A secret needs a name (e.g. ORUCRAFT_API) and the hosts it's for.");
            if (findSecret(businessId, name)) return ok(`${name} is already stored: use {{secret.${name}}} in http_request.`);
            request = { kind: "secret", name, hosts, why: a.why };
            break;
          }
          case "domain":
            if (!a.domain) return fail("Which domain?");
            request = { kind: "domain", domain: a.domain, why: a.why };
            break;
          case "browser_site":
            if (!a.site) return fail("Which site?");
            request = { kind: "browser_site", site: a.site, why: a.why };
            break;
          case "edit":
            if (!a.area) return fail("Which area: contacts, context or library?");
            if (canTeamEdit(businessId, a.area)) return ok("The team already has that: go ahead.");
            request = { kind: "edit", area: a.area, why: a.why };
            break;
          default:
            request = { kind: a.kind, why: a.why };
        }
        const { approval, duplicate } = requestCapability({ businessId, teammate, taskId, request });
        if (!duplicate) void notifyOwner(approval.id);
        return ok(
          `${duplicate ? "That request is already waiting" : "Asked the owner"} on the Approvals page. Don't wait: finish what you can now, tell the owner what you asked for and why. If they approve, you'll get a new task to carry on.`,
        );
      },
    ),
  );

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
          // Chains of hand-offs multiply cost without adding work: stop them early.
          if (delegationDepth(taskId) + 1 > MAX_DELEGATION_DEPTH) {
            return fail("This request has already been handed on too many times. Do the work yourself or tell the owner what's missing.");
          }
          const task = createTask({
            businessId,
            teammateId: target.id,
            title: deriveTaskTitle(a.instructions),
            // The owner's own words travel with the brief.
            instructions: delegatedInstructions(a.instructions, teammate.name, ownerRequest(taskId)),
            attachments: files,
            createdBy: `teammate:${teammate.id}`,
            // Whoever delegates hears back when it's done (onTaskFinished, src/lib/manager.ts).
            parentTaskId: taskId,
          });
          ev("delegated", `${teammate.name} asked ${target.name}: ${task.title}`, {
            from: teammate.id,
            to: target.id,
            delegatedTaskId: task.id,
          });
          return ok(
            `Assigned to ${target.name} (task ${task.id})${files.length ? ` with ${files.length} file(s)` : ""}. They'll work on it after you${ctx.isManager ? "" : ", and their results come back to you as a new task when they're done"}.`,
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
          const can = [m.browserAccess && "browser", m.whatsappAccess && "WhatsApp", m.repoAccess && "code repositories/GitHub"].filter(Boolean).join(", ") || "no browser/WhatsApp/code";
          return `- ${m.name}, ${m.title}: ${m.state}${m.currentActivity ? ` (“${m.currentActivity}”)` : ""}; freedom ${m.autonomy}; ${can}${mine.length ? `; open: ${mine.join("; ")}` : ""}`;
        });
        const waits = activeWatches(businessId);
        const names = new Map(mates().map((m) => [m.id, m.name]));
        const waiting = waits.length ? `\n\nWaiting for WhatsApp replies:\n${waits.map((w) => describeWatch(w, names.get(w.teammateId) ?? "you")).join("\n")}` : "";
        return ok((lines.join("\n") || "No teammates yet.") + waiting);
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

  if (ctx.isManager && ctx.reviewRequestId) {
    const requestId = ctx.reviewRequestId;
    tools.push(
      tool(
        "request_revision",
        "Send a teammate's saved work back for one round of fixes before you report to the owner. Only for real problems (wrong facts, ignores the request, off-brand, unfinished), with exactly what to fix. They revise the same deliverable, and you report again when they're done. One revision round per request.",
        {
          deliverable_id: z.string(),
          fix: z.string().describe("Exactly what to change and why, in a few lines"),
        },
        async (a) => {
          const d = db
            .select()
            .from(schema.deliverables)
            .where(and(eq(schema.deliverables.id, a.deliverable_id), eq(schema.deliverables.businessId, businessId)))
            .get();
          if (!d) return fail(`No deliverable with id ${a.deliverable_id}.`);
          if (d.status === "published") return fail("The owner already posted it; mention the problem in your report instead.");
          if (!d.teammateId || d.teammateId === teammate.id) return fail("That's your own work: fix it with update_deliverable.");
          const sent = db
            .select({ id: schema.tasks.id })
            .from(schema.tasks)
            .where(and(eq(schema.tasks.parentTaskId, requestId), eq(schema.tasks.createdBy, REVISION), eq(schema.tasks.deliverableId, d.id)))
            .get();
          if (sent) return fail(`"${d.title}" already went back once for this request. Report it as it is and say what's still off.`);
          const maker = db.select().from(schema.teammates).where(eq(schema.teammates.id, d.teammateId)).get();
          const task = queueRevision({ d, maker, note: a.fix, from: "manager", parentTaskId: requestId });
          if (!task) return fail("Nobody can revise it (its maker left the team). Report it as it is.");
          ev("revision_requested", `${teammate.name} sent "${d.title}" back to ${maker?.name ?? "the team"}: ${a.fix.replace(/\s+/g, " ").slice(0, 120)}`, {
            deliverableId: d.id,
            revisionTaskId: task.id,
          });
          return ok(`Sent back to ${maker?.name ?? "the team"} (task ${task.id}). You'll get another report task when it's done; tell the owner briefly that it's being polished.`);
        },
      ),
    );
  }

  return createSdkMcpServer({ name: BIZ_SERVER, version: "0.1.0", tools, alwaysLoad: true });
}
