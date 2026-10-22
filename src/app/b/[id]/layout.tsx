import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/kit";
import { I18nProvider } from "@/components/i18n";
import { getBusiness, pendingApprovalCount } from "@/lib/data";
import { uiLang } from "@/lib/i18n";
import { BusinessRail, MainFrame } from "./nav";
import { WorkerBanner } from "./worker-banner";

// Not async, so the shell can prerender. The UI language comes from businesses.language,
// a request-time read, so the provider (and the page under it) sits inside Suspense.
export default function BusinessLayout({ children, params }: LayoutProps<"/b/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex">
          <div className="hidden w-[4.75rem] shrink-0 border-r-[3px] border-sidebar-border bg-sidebar md:block" />
          <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">
            <PageSkeleton />
          </main>
        </div>
      }
    >
      <BusinessShell params={params}>{children}</BusinessShell>
    </Suspense>
  );
}

/**
 * The rail on the left (a bottom bar on a phone), the page next to it. Once the team is
 * hired the Interview item steps back (the Business page still links to it).
 * `lang` on the wrapper: <html lang> is static in the root layout (it can't wait on a request
 * under Cache Components), so this marks the business's part of the page instead.
 */
async function BusinessShell({ params, children }: { params: LayoutProps<"/b/[id]">["params"]; children: ReactNode }) {
  const { id } = await params;
  const biz = await getBusiness(id);
  const lang = uiLang(biz?.language);
  const pending = biz ? await pendingApprovalCount(id) : 0;
  return (
    <I18nProvider lang={lang}>
      <div lang={lang} className="flex-1 flex">
        <BusinessRail hideInterview={biz?.status === "active"} pendingApprovals={pending} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={null}>
            <WorkerBanner params={params} lang={lang} />
          </Suspense>
          <MainFrame>{children}</MainFrame>
        </div>
      </div>
    </I18nProvider>
  );
}
