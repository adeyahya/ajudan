import Link from "next/link";
import { connection } from "next/server";
import { folderInfo, readConfig } from "@/lib/folders";

/** Header chip: which business folder is open, with a link to switch. */
export async function OpenFolderBadge() {
  await connection();
  const dir = readConfig().activeFolder;
  const info = dir ? folderInfo(dir) : null;
  return (
    <Link
      href="/"
      title={dir ?? "No business open"}
      className="font-pixel ml-auto flex items-center gap-2 bg-ink/85 px-2.5 py-1 text-xs text-parchment shadow-[-2px_0_0_var(--frame),2px_0_0_var(--frame),0_-2px_0_var(--frame),0_2px_0_var(--frame)] hover:bg-ink"
    >
      <span aria-hidden>{info ? "▣" : "▢"}</span>
      <span className="max-w-40 truncate">{info ? info.name : "No business open"}</span>
      <span className="text-primary">Switch ▸</span>
    </Link>
  );
}
