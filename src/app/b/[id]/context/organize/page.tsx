import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db, schema } from "@/db";
import { SetBreadcrumb } from "@/components/breadcrumb";
import { LiveRefresh } from "@/components/live";
import { PageBody, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
import { resolveWorkspace } from "@/lib/paths";
import { pendingReorganize, reorganizeState } from "@/lib/reorganize";
import { contextBase, suggestionView } from "../data";
import { OrganizeView } from "./organize";

/** Context → Organize: the "Reorganize with AI" review, its proposals, the weekly switch, and tidying teammates' memory. */
export default function OrganizePage(props: PageProps<"/b/[id]/context/organize">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/context/organize">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = uiLang(business.language);
  const { pages, mates, mateViews, managerId } = await contextBase(id);
  const state = reorganizeState(id);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const names = new Map(mates.map((m) => [m.id, m.name]));
  const proposals = pendingReorganize(id).map((s) => suggestionView(s, s.pageId ? byId.get(s.pageId) : undefined, names, managerId));
  const last = db
    .select({ data: schema.activityEvents.data, createdAt: schema.activityEvents.createdAt })
    .from(schema.activityEvents)
    .where(and(eq(schema.activityEvents.businessId, id), eq(schema.activityEvents.type, "context_reorganized")))
    .orderBy(desc(schema.activityEvents.createdAt))
    .get();
  const memories = mates.map((m) => {
    let bytes = 0;
    try {
      if (m.workspaceDir) bytes = fs.statSync(path.join(resolveWorkspace(m.workspaceDir), "memory.md")).size;
    } catch {
      // never ran
    }
    return { id: m.id, name: m.name, color: m.color, title: m.title, bytes };
  });

  return (
    <PageBody width="wide">
      <LiveRefresh businessId={id} types={["context_reorganized", "context_reorganize_failed", "context_suggested", "context_decided", "memory_consolidated"]} />
      <SetBreadcrumb items={[{ label: t(lang, "context.tab.organize") }]} />
      <header className="mb-8">
        <Sparkles aria-hidden className="mb-3 size-8 text-foreground" strokeWidth={1.5} />
        <h1 className="text-[28px] leading-[34px] font-bold tracking-tight">{t(lang, "context.organize.title")}</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm leading-[22px] text-muted-foreground">{t(lang, "context.organize.help")}</p>
      </header>
      <OrganizeView
        businessId={id}
        state={{
          status: state.job?.status ?? null,
          error: state.job?.status === "failed" ? (state.job.error ?? "") : null,
          weekly: state.weekly,
          lastRunAt: state.lastRunAt?.toISOString() ?? null,
          summary: typeof (last?.data as { summary?: unknown } | null)?.summary === "string" ? (last!.data as { summary: string }).summary : null,
        }}
        proposals={proposals}
        mates={mateViews}
        memories={memories}
      />
    </PageBody>
  );
}
