import Link from "next/link";
import { connection } from "next/server";
import { IN_APP, pinnedFolder } from "@/lib/app-mode";
import { folderInfo, readConfig } from "@/lib/folders";
import { ShowBusinessesButton } from "./show-businesses-button";

const CHIP =
  "font-pixel ml-auto flex items-center gap-2 bg-ink/85 px-2.5 py-1 text-xs text-parchment shadow-[-2px_0_0_var(--frame),2px_0_0_var(--frame),0_-2px_0_var(--frame),0_2px_0_var(--frame)] hover:bg-ink";

/** Header chip: which business folder is open, with a link to switch. */
export async function OpenFolderBadge() {
  await connection();
  const dir = IN_APP ? pinnedFolder() : readConfig().activeFolder;
  const info = dir ? folderInfo(dir) : null;
  const label = (
    <>
      <span aria-hidden>{info ? "▣" : "▢"}</span>
      <span className="max-w-40 truncate">{info ? info.name : IN_APP ? "Businesses" : "No business open"}</span>
    </>
  );
  // Desktop app: each business has its own window; the chip brings up the list.
  if (IN_APP) {
    return (
      <ShowBusinessesButton className={CHIP} title={dir ?? "Your businesses"}>
        {label}
        {dir && <span className="text-primary">Businesses ▸</span>}
      </ShowBusinessesButton>
    );
  }
  return (
    <Link href="/" title={dir ?? "No business open"} className={CHIP}>
      {label}
      <span className="text-primary">Switch ▸</span>
    </Link>
  );
}
