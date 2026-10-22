import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { EditKind } from "@/db/schema";
import { listLibrary, type LibraryItem } from "@/lib/assets";
import { mediaInfo } from "@/lib/media";
import { dataDir } from "@/lib/paths";

/** Read helpers for the Studio editors (Server Components; see src/lib/data.ts). */

export type EditorSource = Pick<LibraryItem, "path" | "name" | "title" | "kind" | "album" | "starred"> & {
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
};

/** Library videos and audio with their length (newest first, at most 120). */
export async function editorSources(businessId: string): Promise<EditorSource[]> {
  await connection();
  const dir = dataDir();
  const items = listLibrary(businessId)
    .filter((i) => i.kind === "video" || i.kind === "audio")
    .slice(0, 120);
  return Promise.all(
    items.map(async (i) => {
      const info = await mediaInfo(path.join(dir, i.path));
      return {
        path: i.path,
        name: i.name,
        title: i.title,
        kind: i.kind,
        album: i.album,
        starred: i.starred,
        duration: info.durationSec ?? 0,
        width: info.width,
        height: info.height,
        hasAudio: info.hasAudio,
      };
    }),
  );
}

export async function listEdits(businessId: string, kind: EditKind) {
  await connection();
  return db
    .select()
    .from(schema.edits)
    .where(and(eq(schema.edits.businessId, businessId), eq(schema.edits.kind, kind)))
    .orderBy(desc(schema.edits.createdAt))
    .limit(100)
    .all();
}
