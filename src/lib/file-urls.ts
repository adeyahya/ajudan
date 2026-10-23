/**
 * A small preview of an image or video (GET /api/b/[id]/thumb/…, src/lib/thumbs.ts). Pass
 * the file's mtime when known, so a changed file isn't shown from the browser cache.
 * Plain module: usable from Server and Client Components.
 */
export const thumbUrl = (businessId: string, rel: string, mtime?: number | Date) =>
  `/api/b/${businessId}/thumb/${rel.split("/").map(encodeURIComponent).join("/")}${mtime !== undefined ? `?v=${Math.round(+mtime)}` : ""}`;
