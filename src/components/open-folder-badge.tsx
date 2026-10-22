import Link from "next/link";
import { connection } from "next/server";
import { IN_APP, pinnedFolder } from "@/lib/app-mode";
import { folderInfo, readConfig } from "@/lib/folders";
import { t } from "@/lib/i18n";
import { chromeLang } from "@/lib/i18n/server";
import { ShowBusinessesButton } from "./show-businesses-button";

const CHIP =
  "font-pixel ml-auto flex items-center gap-2 bg-ink/85 px-2.5 py-1 text-xs text-parchment shadow-[-2px_0_0_var(--frame),2px_0_0_var(--frame),0_-2px_0_var(--frame),0_2px_0_var(--frame)] hover:bg-ink";

/** Header chip: which business folder is open, with a link to switch. */
export async function OpenFolderBadge() {
  await connection();
  const dir = IN_APP ? pinnedFolder() : readConfig().activeFolder;
  const info = dir ? folderInfo(dir) : null;
  const lang = await chromeLang();
  const label = (
    <>
      <span aria-hidden>{info ? "▣" : "▢"}</span>
      <span className="max-w-40 truncate">{info ? info.name : IN_APP ? t(lang, "header.businesses") : t(lang, "header.noBusinessOpen")}</span>
    </>
  );
  // Desktop app: each business has its own window; the chip brings up the list.
  if (IN_APP) {
    return (
      <ShowBusinessesButton className={CHIP} title={dir ?? t(lang, "header.yourBusinesses")}>
        {label}
        {dir && <span className="text-primary">{t(lang, "header.businessesSwitch")}</span>}
      </ShowBusinessesButton>
    );
  }
  return (
    <Link href="/" title={dir ?? t(lang, "header.noBusinessOpen")} className={CHIP}>
      {label}
      <span className="text-primary">{t(lang, "header.switch")}</span>
    </Link>
  );
}

/** Header tagline, in the open business's language (render inside <Suspense>). */
export async function HeaderTagline() {
  const lang = await chromeLang();
  return <span className="font-pixel hidden text-xs text-ink/70 sm:inline">{t(lang, "header.tagline")}</span>;
}
