import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Badge, Button, Card, PageHeader, PageSkeleton } from "@/components/kit";
import { I18nProvider } from "@/components/i18n";
import { IN_APP, pinnedFolder, routeFor } from "@/lib/app-mode";
import { AJUDAN_HOME, folderInfo, knownFolders, readConfig, type FolderInfo } from "@/lib/folders";
import { t, tn, type MessageKey, type UiLang } from "@/lib/i18n";
import { chromeLang } from "@/lib/i18n/server";
import { folderWorker } from "@/lib/worker-lock";
import { forgetFolderAction, openFolder } from "./actions";
import { AppOpenButton, NewBusinessForm, OpenFolderForm } from "./home-forms";

const STATUS: Record<string, { label: MessageKey; tone: "amber" | "blue" | "violet" | "green" }> = {
  onboarding: { label: "businessStatus.onboarding", tone: "amber" },
  designing: { label: "businessStatus.designing", tone: "blue" },
  team_proposed: { label: "businessStatus.team_proposed", tone: "violet" },
  active: { label: "businessStatus.active", tone: "green" },
};

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

// The UI language is a request-time read (open business, else Accept-Language: see
// chromeLang), so the whole page sits inside Suspense under Cache Components.
export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
          <PageSkeleton />
        </main>
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
  return (
    <I18nProvider lang={lang}>
      <main lang={lang} className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader title={t(lang, "home.title")} subtitle={IN_APP ? t(lang, "home.subtitleApp") : t(lang, "home.subtitleWeb")} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
          {IN_APP ? <AppFolderList lang={lang} /> : <FolderList lang={lang} />}

          <Card className="p-5">
            <h2 className="mb-1 text-lg text-foreground">{t(lang, "home.newTitle")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t(lang, "home.newBody")}</p>
            <NewBusinessForm home={AJUDAN_HOME} defaultLanguage={lang} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-lg text-foreground">{t(lang, "home.openTitle")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t(lang, "home.openBody")}</p>
            <OpenFolderForm />
          </Card>
        </div>
      </main>
    </I18nProvider>
  );
}

function FolderList({ lang }: { lang: UiLang }) {
  const active = readConfig().activeFolder;
  const folders = knownFolders().sort((a, b) => Number(b.dir === active) - Number(a.dir === active));
  if (!folders.length) {
    return <p className="text-sm text-muted-foreground">{t(lang, "home.empty", { dir: tilde(AJUDAN_HOME) })}</p>;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {folders.map((f) => (
        <FolderCard key={f.dir} f={f} isOpen={f.dir === active} lang={lang} />
      ))}
    </div>
  );
}

function FolderMeta({ f, lang }: { f: FolderInfo; lang: UiLang }) {
  return (
    <>
      <div className="truncate font-mono text-xs text-muted-foreground">{tilde(f.dir)}</div>
      <div className="text-xs text-muted-foreground">
        {f.website ?? t(lang, "home.noWebsite")} · {tn(lang, "teammates", f.teammates)}
      </div>
    </>
  );
}

function RemoveButton({ dir, lang }: { dir: string; lang: UiLang }) {
  return (
    <form action={forgetFolderAction.bind(null, dir)}>
      <Button type="submit" variant="ghost" title={t(lang, "home.removeTitle")}>
        {t(lang, "home.remove")}
      </Button>
    </form>
  );
}

/** Desktop app: every business opens in its own window and keeps working while it's open. */
function AppFolderList({ lang }: { lang: UiLang }) {
  const folders = knownFolders().sort((a, b) => Number(!!folderWorker(b.dir)) - Number(!!folderWorker(a.dir)));
  if (!folders.length) {
    return <p className="text-sm text-muted-foreground">{t(lang, "home.empty", { dir: tilde(AJUDAN_HOME) })}</p>;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {folders.map((f) => {
        const running = !!folderWorker(f.dir);
        const s = f.status ? STATUS[f.status] : undefined;
        return (
          <Card key={f.dir} className={`flex flex-wrap items-center gap-4 p-4 ${running ? "outline-3 outline-primary" : ""}`}>
            <span aria-hidden className="font-pixel text-3xl leading-none text-primary">
              {running ? "▣" : "▢"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-pixel text-lg">{f.name}</span>
                {running && <Badge tone="green">{t(lang, "home.running")}</Badge>}
                {!f.exists && <Badge tone="red">{t(lang, "home.folderMissing")}</Badge>}
                {s && <Badge tone={s.tone}>{t(lang, s.label)}</Badge>}
              </div>
              <FolderMeta f={f} lang={lang} />
            </div>
            <div className="flex gap-2">
              {f.exists && f.businessId && (
                <AppOpenButton dir={f.dir} label={running ? t(lang, "home.showWindow") : t(lang, "home.openInWindow")} />
              )}
              {!running && <RemoveButton dir={f.dir} lang={lang} />}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function FolderCard({ f, isOpen, lang }: { f: FolderInfo; isOpen: boolean; lang: UiLang }) {
  const s = f.status ? STATUS[f.status] : undefined;
  return (
    <Card className={`flex flex-wrap items-center gap-4 p-4 ${isOpen ? "outline-3 outline-primary" : ""}`}>
      <span aria-hidden className="font-pixel text-3xl leading-none text-primary">
        {isOpen ? "▣" : "▢"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-pixel text-lg">{f.name}</span>
          {isOpen && <Badge tone="green">{t(lang, "home.open")}</Badge>}
          {!isOpen && f.exists && <Badge>{t(lang, "home.paused")}</Badge>}
          {!f.exists && <Badge tone="red">{t(lang, "home.folderMissing")}</Badge>}
          {s && <Badge tone={s.tone}>{t(lang, s.label)}</Badge>}
        </div>
        <FolderMeta f={f} lang={lang} />
      </div>
      <div className="flex gap-2">
        {f.exists && f.businessId && (
          <form action={openFolder.bind(null, f.dir)}>
            <Button type="submit">{isOpen ? t(lang, "home.continue") : t(lang, "home.switchTo")}</Button>
          </form>
        )}
        {!isOpen && <RemoveButton dir={f.dir} lang={lang} />}
      </div>
    </Card>
  );
}
