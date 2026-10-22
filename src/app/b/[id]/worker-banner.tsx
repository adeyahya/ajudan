import Link from "next/link";
import { connection } from "next/server";
import { IN_APP, pinnedFolder } from "@/lib/app-mode";
import { readConfig } from "@/lib/folders";
import { t, type UiLang } from "@/lib/i18n";
import { folderWorker } from "@/lib/worker-lock";

/**
 * Shown when no worker holds the open folder's lock: nothing runs without one, and
 * the owner would otherwise watch "Researching your business…" forever.
 * Render inside <Suspense>: it reads the lock file at request time.
 */
export async function WorkerBanner({ params, lang }: { params: Promise<{ id: string }>; lang: UiLang }) {
  await connection();
  const dir = IN_APP ? pinnedFolder() : readConfig().activeFolder;
  if (!dir || folderWorker(dir)) return null;
  const { id } = await params;
  return (
    <div role="status" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-foreground sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-pixel text-destructive">{t(lang, "workerBanner.title")}</span>
        <span className="text-muted-foreground">
          {IN_APP ? t(lang, "workerBanner.app") : t(lang, "workerBanner.dev")}
        </span>
        <Link href={`/b/${id}/health`} className="text-xs underline text-muted-foreground hover:text-foreground">
          {t(lang, "workerBanner.link")}
        </Link>
      </div>
    </div>
  );
}
