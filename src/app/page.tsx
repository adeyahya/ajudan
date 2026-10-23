import { Store } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Badge, Button, EmptyState, ListSkeleton, PageBody, PageHeader, Skeleton, cn } from "@/components/kit";
import { I18nProvider } from "@/components/i18n";
import { Toaster } from "@/components/ui/sonner";
import { IN_APP, pinnedFolder, routeFor } from "@/lib/app-mode";
import { AJUDAN_HOME, folderInfo, knownFolders, readConfig, type FolderInfo } from "@/lib/folders";
import { t, tn, type UiLang } from "@/lib/i18n";
import { chromeLang } from "@/lib/i18n/server";
import { statusTone } from "@/lib/status-tones";
import { folderWorker } from "@/lib/worker-lock";
import { openFolder } from "./actions";
import { AppOpenButton, AppStopButton, FolderMenu, NewBusinessDialog, OpenFolderDialog, SiteHeaderActions } from "./home-forms";

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/**
 * Home: the businesses on this computer (UI-PLAN §3.13). Rows in one hairline list;
 * "New business" sits in the top bar (#site-header-actions), "Open a folder…" under the
 * list. Web: one business works at a time (Continue / Switch). Desktop app: each business
 * opens in its own window (Open in window / Show window).
 *
 * The UI language is a request-time read (open business, else Accept-Language: see
 * chromeLang), so the whole page sits inside Suspense under Cache Components.
 */
export default function Home() {
  return (
    <Suspense
      fallback={
        <PageBody className="sm:pt-16">
          <Skeleton className="h-[34px] w-60 rounded-md" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <ListSkeleton rows={3} className="mt-10" />
        </PageBody>
      }
    >
      <Content />
    </Suspense>
  );
}

async function Content() {
  const lang = await chromeLang();
  // A business window of the desktop app goes straight to its business.
  const pinned = pinnedFolder();
  if (pinned) {
    const info = folderInfo(pinned);
    if (info.businessId) redirect(routeFor(info.businessId, info.status));
  }
  const active = readConfig().activeFolder;
  const folders = knownFolders();
  const running = IN_APP ? new Set(folders.filter((f) => folderWorker(f.dir)).map((f) => f.dir)) : new Set<string>();
  // The open one (web) or the running ones (app) first.
  const sorted = [...folders].sort((a, b) =>
    IN_APP ? Number(running.has(b.dir)) - Number(running.has(a.dir)) : Number(b.dir === active) - Number(a.dir === active),
  );

  return (
    <I18nProvider lang={lang}>
      <Toaster />
      <SiteHeaderActions>
        <NewBusinessDialog home={AJUDAN_HOME} defaultLanguage={lang} />
      </SiteHeaderActions>
      <main lang={lang} className="flex-1">
        <PageBody className="sm:pt-16">
          <PageHeader title={t(lang, "home.title")} description={IN_APP ? t(lang, "home.subtitleApp") : t(lang, "home.subtitleWeb")} />
          {sorted.length ? (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {sorted.map((f) => (
                  <FolderRow key={f.dir} f={f} lang={lang} isOpen={IN_APP ? running.has(f.dir) : f.dir === active} />
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <OpenFolderDialog />
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Store />}
              title={t(lang, "home.emptyTitle")}
              body={t(lang, "home.emptyBody", { dir: tilde(AJUDAN_HOME) })}
              action={
                <>
                  <NewBusinessDialog home={AJUDAN_HOME} defaultLanguage={lang} />
                  <OpenFolderDialog variant="secondary" />
                </>
              }
            />
          )}
        </PageBody>
      </main>
    </I18nProvider>
  );
}

/** One business: initial tile, name + tags, path and meta; the open/switch action and a "…" menu on the right. */
function FolderRow({ f, isOpen, lang }: { f: FolderInfo; isOpen: boolean; lang: UiLang }) {
  const s = f.status ? statusTone("business", f.status) : undefined;
  let action: ReactNode = null;
  if (f.exists && f.businessId) {
    action = IN_APP ? (
      <>
        {isOpen && <AppStopButton dir={f.dir} name={f.name} label={t(lang, "home.stop")} title={t(lang, "home.stopTitle")} />}
        <AppOpenButton dir={f.dir} label={isOpen ? t(lang, "home.switchToRunning") : t(lang, "home.start")} />
      </>
    ) : (
      <form action={openFolder.bind(null, f.dir)}>
        <Button type="submit" size="sm" variant={isOpen ? "primary" : "secondary"}>
          {isOpen ? t(lang, "home.continue") : t(lang, "home.switchTo")}
        </Button>
      </form>
    );
  }
  return (
    <li className={cn("flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors duration-100 hover:bg-hover/50", !f.exists && "opacity-70")}>
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold",
          isOpen ? "bg-foreground text-background" : "bg-secondary text-muted-foreground",
        )}
      >
        {(f.name.trim()[0] ?? "?").toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm leading-5 font-semibold text-foreground">{f.name}</span>
          {isOpen && <Badge tone="green">{IN_APP ? t(lang, "home.running") : t(lang, "home.open")}</Badge>}
          {!IN_APP && !isOpen && f.exists && <Badge>{t(lang, "home.paused")}</Badge>}
          {!f.exists && <Badge tone="red">{t(lang, "home.folderMissing")}</Badge>}
          {s && <Badge tone={s.tone}>{t(lang, s.label)}</Badge>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-tertiary">
          <span className="truncate font-mono" title={f.dir}>
            {tilde(f.dir)}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0 truncate">{f.website?.replace(/^https?:\/\//, "") ?? t(lang, "home.noWebsite")}</span>
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <span className="hidden shrink-0 sm:inline">{tn(lang, "teammates", f.teammates)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        {isOpen ? <span aria-hidden className="size-7" /> : <FolderMenu dir={f.dir} name={f.name} />}
      </div>
    </li>
  );
}
