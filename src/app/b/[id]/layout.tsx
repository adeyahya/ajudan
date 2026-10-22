import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/kit";
import { I18nProvider } from "@/components/i18n";
import { IN_APP } from "@/lib/app-mode";
import { getBusiness, getSpend, listTeammates, pendingApprovalCount } from "@/lib/data";
import { knownFolders } from "@/lib/folders";
import { uiLang } from "@/lib/i18n";
import { currentDataDir } from "@/lib/paths";
import { AppShell, type ShellFolder } from "./nav";
import { workerRunning } from "./worker-banner";

// Not async, so the shell can prerender. The UI language comes from businesses.language,
// a request-time read, so the provider (and the page under it) sits inside Suspense.
// The fallback draws the same frame as the real shell (sidebar width from the inline
// script in the root layout, 44px top bar) so nothing moves when it streams in.
export default function BusinessLayout({ children, params }: LayoutProps<"/b/[id]">) {
  return (
    <Suspense
      fallback={
        <div data-business-shell className="flex min-h-dvh w-full">
          <div className="app-sidebar sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-sidebar md:block" />
          <div className="min-w-0 flex-1">
            <div className="h-(--topbar-h)" />
            <PageSkeleton />
          </div>
        </div>
      }
    >
      <BusinessShell params={params}>{children}</BusinessShell>
    </Suspense>
  );
}

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");

/**
 * Reads what the chrome needs (business, folders for the switcher, teammates for the
 * palette and breadcrumbs, spend, worker lock, Inbox count) and hands it to AppShell.
 * `lang` on the wrapper: <html lang> is static in the root layout (it can't wait on a
 * request under Cache Components), so this marks the business's part of the page instead.
 * LiveRefresh on a page re-renders this layout too, so the Inbox count follows SSE.
 */
async function BusinessShell({ params, children }: { params: LayoutProps<"/b/[id]">["params"]; children: ReactNode }) {
  const { id } = await params;
  const biz = await getBusiness(id);
  const lang = uiLang(biz?.language);
  const [pending, spend, teammates, running] = biz
    ? await Promise.all([pendingApprovalCount(id), getSpend(id), listTeammates(id), workerRunning()])
    : [0, { today: 0, week: 0, cap: 0, over: false }, [], true];
  const open = currentDataDir();
  // A folder pinned by AJUDAN_DATA_DIR outside the app (tests, scratch dev servers) can't switch.
  const pinnedDev = Boolean(process.env.AJUDAN_DATA_DIR) && !IN_APP;
  const folders: ShellFolder[] = (pinnedDev ? [] : knownFolders())
    .filter((f) => f.exists)
    .map((f) => ({ dir: f.dir, name: f.name, path: tilde(f.dir), status: f.status, isOpen: f.dir === open }))
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen));
  if (open && !folders.some((f) => f.isOpen)) {
    folders.unshift({ dir: open, name: biz?.name ?? open, path: tilde(open), status: biz?.status ?? null, isOpen: true });
  }

  return (
    <I18nProvider lang={lang}>
      <div lang={lang} className="contents">
        <AppShell
          businessId={id}
          businessName={biz?.name ?? "Ajudan"}
          hideInterview={biz?.status === "active"}
          pendingApprovals={pending}
          inApp={IN_APP}
          workerRunning={running}
          spend={spend}
          folders={folders}
          teammates={teammates.map((m) => ({ id: m.id, name: m.name, title: m.title, color: m.color, state: m.state }))}
        >
          {children}
        </AppShell>
      </div>
    </I18nProvider>
  );
}
