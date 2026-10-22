import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge, Button, Card, PageHeader, PageSkeleton } from "@/components/kit";
import { IN_APP, pinnedFolder, routeFor } from "@/lib/app-mode";
import { AJUDAN_HOME, folderInfo, knownFolders, readConfig, type FolderInfo } from "@/lib/folders";
import { folderWorker } from "@/lib/worker-lock";
import { forgetFolderAction, openFolder } from "./actions";
import { AppOpenButton, NewBusinessForm, OpenFolderForm } from "./home-forms";

const STATUS: Record<string, { label: string; tone: "amber" | "blue" | "violet" | "green" }> = {
  onboarding: { label: "Interview", tone: "amber" },
  designing: { label: "Designing team", tone: "blue" },
  team_proposed: { label: "Team proposed", tone: "violet" },
  active: { label: "Active", tone: "green" },
};

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <PageHeader
        title="Your businesses"
        subtitle={
          IN_APP
            ? "Each business lives in its own folder: its team, work, history and logged-in browser. Open one per window; every open window keeps working at the same time."
            : "Each business lives in its own folder: its team, work, history and logged-in browser. Only the open business works; the others are paused until you switch back."
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
        <Suspense fallback={<PageSkeleton />}>
          <FolderList />
        </Suspense>

        <Card className="p-5">
          <h2 className="mb-1 text-lg text-primary">Start a new business</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Ajudan creates a folder for it, looks at your website, then interviews you for a few minutes.
          </p>
          <NewBusinessForm home={AJUDAN_HOME} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-lg text-primary">Open a business folder</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            For a folder that isn&apos;t listed above, for example one you moved, copied from another laptop or restored
            from a backup.
          </p>
          <OpenFolderForm />
        </Card>
      </div>
    </main>
  );
}

async function FolderList() {
  await connection();
  // A business window of the desktop app goes straight to its business.
  const pinned = pinnedFolder();
  if (pinned) {
    const info = folderInfo(pinned);
    if (info.businessId) redirect(routeFor(info.businessId, info.status));
  }
  if (IN_APP) return <AppFolderList />;
  const active = readConfig().activeFolder;
  const folders = knownFolders().sort((a, b) => Number(b.dir === active) - Number(a.dir === active));
  if (!folders.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No businesses yet. Start one below; it will be saved in {tilde(AJUDAN_HOME)}.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {folders.map((f) => (
        <FolderCard key={f.dir} f={f} isOpen={f.dir === active} />
      ))}
    </div>
  );
}

/** Desktop app: every business opens in its own window and keeps working while it's open. */
function AppFolderList() {
  const folders = knownFolders().sort((a, b) => Number(!!folderWorker(b.dir)) - Number(!!folderWorker(a.dir)));
  if (!folders.length) {
    return <p className="text-sm text-muted-foreground">No businesses yet. Start one below; it will be saved in {tilde(AJUDAN_HOME)}.</p>;
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
                {running && <Badge tone="green">Running</Badge>}
                {!f.exists && <Badge tone="red">Folder missing</Badge>}
                {s && <Badge tone={s.tone}>{s.label}</Badge>}
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground">{tilde(f.dir)}</div>
              <div className="text-xs text-muted-foreground">
                {f.website ?? "No website"} · {f.teammates} teammate{f.teammates === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex gap-2">
              {f.exists && f.businessId && <AppOpenButton dir={f.dir} label={running ? "Show window" : "Open in a window"} />}
              {!running && (
                <form action={forgetFolderAction.bind(null, f.dir)}>
                  <Button type="submit" variant="ghost" title="Remove from this list. The folder stays on disk.">
                    Remove from list
                  </Button>
                </form>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function FolderCard({ f, isOpen }: { f: FolderInfo; isOpen: boolean }) {
  const s = f.status ? STATUS[f.status] : undefined;
  return (
    <Card className={`flex flex-wrap items-center gap-4 p-4 ${isOpen ? "outline-3 outline-primary" : ""}`}>
      <span aria-hidden className="font-pixel text-3xl leading-none text-primary">
        {isOpen ? "▣" : "▢"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-pixel text-lg">{f.name}</span>
          {isOpen && <Badge tone="green">Open</Badge>}
          {!isOpen && f.exists && <Badge>Paused</Badge>}
          {!f.exists && <Badge tone="red">Folder missing</Badge>}
          {s && <Badge tone={s.tone}>{s.label}</Badge>}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">{tilde(f.dir)}</div>
        <div className="text-xs text-muted-foreground">
          {f.website ?? "No website"} · {f.teammates} teammate{f.teammates === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex gap-2">
        {f.exists && f.businessId && (
          <form action={openFolder.bind(null, f.dir)}>
            <Button type="submit">{isOpen ? "Continue" : "Switch to this"}</Button>
          </form>
        )}
        {!isOpen && (
          <form action={forgetFolderAction.bind(null, f.dir)}>
            <Button type="submit" variant="ghost" title="Remove from this list. The folder stays on disk.">
              Remove from list
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
