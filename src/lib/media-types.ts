/** File types Ajudan accepts and serves (safe to import in client components). */
export const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
};

export type MediaKind = "video" | "image" | "audio" | "file";

export function mediaKind(file: string): MediaKind {
  const ext = /\.[^./]+$/.exec(file.toLowerCase())?.[0] ?? "";
  const type = MEDIA_TYPES[ext] ?? "";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

/** Accept attribute for file pickers. */
export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(",");
