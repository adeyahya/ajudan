import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { newMediaPath } from "@/lib/media";
import { dataDir } from "@/lib/paths";

/**
 * Free music, sound effects and images for the team's videos and posts, from
 * Openverse (openverse.org: Jamendo, Freesound, Wikimedia and more; no API key,
 * 200 searches a day). Only licenses that are safe for ads are allowed: CC0, public
 * domain and CC BY (credit the creator). No NC (non-commercial), ND (no edits) or SA
 * (share-alike, would force the license onto the whole video).
 *
 * Downloads go to the media library; their credits are kept in media/.licenses.json.
 */

const API = "https://api.openverse.org/v1";
const LICENSES = "cc0,pdm,by";
const MAX_BYTES = 60 * 1024 * 1024;
const UA = "Ajudan/0.1 (local business assistant; https://openverse.org)";

export type FreeAssetType = "music" | "sound_effect" | "image";

export type FreeAsset = {
  id: string;
  type: FreeAssetType;
  title: string;
  creator: string;
  license: string;
  licenseUrl: string;
  /** Where a person can see the asset (and the creator). */
  pageUrl: string;
  source: string;
  durationSec?: number;
  width?: number;
  height?: number;
  attribution: string;
  /** Whether the credit must be shown (CC BY). */
  creditRequired: boolean;
  url: string;
  filetype?: string;
};

type OvItem = {
  id: string;
  title?: string;
  creator?: string;
  license: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  source?: string;
  url: string;
  filetype?: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  attribution?: string;
  tags?: { name: string }[];
};

async function ov<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${API}${pathAndQuery}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 429) throw new Error("The free asset search is rate-limited right now (200 searches a day). Try again later.");
  if (!res.ok) throw new Error(`Openverse returned ${res.status}`);
  return (await res.json()) as T;
}

function toAsset(r: OvItem, type: FreeAssetType): FreeAsset {
  const name = r.license === "pdm" ? "Public Domain" : r.license === "cc0" ? "CC0" : `CC ${r.license.toUpperCase()}`;
  const license = `${name}${r.license_version && r.license !== "pdm" ? ` ${r.license_version}` : ""}`;
  return {
    id: r.id,
    type,
    title: r.title?.trim() || "Untitled",
    creator: r.creator?.trim() || "Unknown",
    license,
    licenseUrl: r.license_url ?? "",
    pageUrl: r.foreign_landing_url ?? "",
    source: r.source ?? "",
    durationSec: r.duration ? Math.round(r.duration / 100) / 10 : undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    attribution: r.attribution ?? `"${r.title}" by ${r.creator} (${license})`,
    creditRequired: r.license === "by",
    url: r.url,
    filetype: r.filetype,
  };
}

export async function searchFreeAssets(p: {
  type: FreeAssetType;
  query: string;
  minSeconds?: number;
  maxSeconds?: number;
  limit?: number;
}) {
  const limit = Math.min(p.limit ?? 10, 20);
  // Fetch a full page: results are filtered by exact length below.
  const q = new URLSearchParams({ q: p.query, license: LICENSES, page_size: "20" });
  if (p.type === "image") {
    q.set("mature", "false");
    const d = await ov<{ results: OvItem[] }>(`/images/?${q}`);
    return d.results.map((r) => toAsset(r, "image")).slice(0, limit);
  }
  // Music: Jamendo tracks are tagged as music. Sound effects: Freesound.
  if (p.type === "music") q.set("category", "music");
  else q.set("source", "freesound");
  // Openverse length buckets: shortest (<30s), short (30s–2min), medium (2–10min), long (>10min).
  const min = p.minSeconds ?? 0;
  const max = p.maxSeconds ?? Infinity;
  const buckets: [string, number, number][] = [["shortest", 0, 30], ["short", 30, 120], ["medium", 120, 600], ["long", 600, Infinity]];
  const lengths = buckets.filter(([, lo, hi]) => max >= lo && min < hi).map(([b]) => b);
  if (lengths.length && lengths.length < buckets.length) q.set("length", lengths.join(","));
  const d = await ov<{ results: OvItem[] }>(`/audio/?${q}`);
  return d.results
    .map((r) => toAsset(r, p.type))
    .filter(
      (a) =>
        a.durationSec === undefined ||
        (a.durationSec >= (p.minSeconds ?? 0) && a.durationSec <= (p.maxSeconds ?? Infinity)),
    )
    .slice(0, limit);
}

const EXT: Record<string, string> = { mp32: ".mp3", mp3: ".mp3", wav: ".wav", ogg: ".ogg", flac: ".flac", m4a: ".m4a", jpg: ".jpg", jpeg: ".jpg", png: ".png", webp: ".webp" };
const CONTENT_EXT: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export type Credit = Omit<FreeAsset, "url" | "filetype"> & { downloadedAt: string };

const licensesFile = () => path.join(dataDir(), "media", ".licenses.json");

/** Credits of downloaded assets, by media path. */
export function readCredits(): Record<string, Credit> {
  try {
    return JSON.parse(fs.readFileSync(licensesFile(), "utf8")) as Record<string, Credit>;
  } catch {
    return {};
  }
}

/**
 * Download an asset found with searchFreeAssets (by its Openverse id, so only
 * Openverse items with an allowed license can be fetched) into the media library.
 */
export async function downloadFreeAsset(id: string, type: FreeAssetType) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Use an id from find_free_assets.");
  const item = await ov<OvItem>(`/${type === "image" ? "images" : "audio"}/${id}/`);
  if (!LICENSES.split(",").includes(item.license)) {
    throw new Error(`Its license (${item.license}) isn't allowed for business use here. Pick a CC0, public domain or CC BY one.`);
  }
  const asset = toAsset(item, type);
  const res = await fetch(asset.url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = CONTENT_EXT[contentType] ?? EXT[(asset.filetype ?? "").toLowerCase()];
  if (!ext || (type === "image" ? !ext.match(/jpg|png|webp/) : !ext.match(/mp3|wav|ogg|flac|m4a/))) {
    throw new Error(`Unexpected file type (${contentType || asset.filetype}).`);
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("The file is too big (over 60 MB).");

  const rel = newMediaPath(`${asset.title}${ext}`);
  const abs = path.join(dataDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      async function* (src: AsyncIterable<Buffer>) {
        for await (const chunk of src) {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) throw new Error("The file is too big (over 60 MB).");
          yield chunk;
        }
      },
      fs.createWriteStream(abs),
    );
  } catch (err) {
    fs.rmSync(abs, { force: true });
    throw err;
  }

  const credits = readCredits();
  credits[rel] = {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    creator: asset.creator,
    license: asset.license,
    licenseUrl: asset.licenseUrl,
    pageUrl: asset.pageUrl,
    source: asset.source,
    durationSec: asset.durationSec,
    width: asset.width,
    height: asset.height,
    attribution: asset.attribution,
    creditRequired: asset.creditRequired,
    downloadedAt: new Date().toISOString(),
  };
  fs.writeFileSync(licensesFile(), JSON.stringify(credits, null, 2));
  return { path: rel, asset };
}

export function describeAsset(a: FreeAsset) {
  const size = a.durationSec !== undefined ? `${a.durationSec}s` : a.width && a.height ? `${a.width}×${a.height}` : "";
  return `- id ${a.id}: "${a.title}" by ${a.creator}${size ? ` (${size})` : ""}, ${a.license}${a.creditRequired ? ", credit required" : ", no credit needed"}, ${a.source}${a.pageUrl ? ` ${a.pageUrl}` : ""}`;
}
