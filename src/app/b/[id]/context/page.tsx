import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live";
import { EditorSkeleton, PageBody } from "@/components/kit";
import { listContacts } from "@/lib/contacts";
import { listLibrary } from "@/lib/assets";
import { pageIcon, usageThisWeek } from "@/lib/context";
import { getBusiness } from "@/lib/data";
import { uiLang } from "@/lib/i18n";
import { contextBase, coverImages, galleryAssets, isStale, mentionContacts, pageHistory, pendingFor, promptSize, readersFor, suggestionView } from "./data";
import { ContextHome } from "./home";
import { PageView } from "./page-view";
import type { CurrentPage } from "./types";

/** One page of the workspace (?page=<id>); without one, the Context home (home.tsx, ?q= searches). */
export default function ContextPage(props: PageProps<"/b/[id]/context">) {
  return (
    <Suspense
      fallback={
        <PageBody className="sm:pt-16">
          <EditorSkeleton />
        </PageBody>
      }
    >
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: PageProps<"/b/[id]/context">["params"]; searchParams: PageProps<"/b/[id]/context">["searchParams"] }) {
  const { id } = await params;
  const { page: wanted, q } = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const { pages, rows, mates, mateViews, managerId } = await contextBase(id);
  const page = pages.find((p) => p.id === wanted);
  if (!page) return <ContextHome businessId={id} lang={uiLang(business.language)} q={typeof q === "string" ? q : ""} />;
  const pending = pendingFor(id);
  const names = new Map(mates.map((m) => [m.id, m.name]));
  const usage = usageThisWeek(id).get(page.id);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ancestors: { id: string; title: string }[] = [];
  for (let up = page.parentId ? byId.get(page.parentId) : undefined; up && !ancestors.some((a) => a.id === up!.id); up = up.parentId ? byId.get(up.parentId) : undefined) {
    ancestors.unshift({ id: up.id, title: up.title });
  }
  const owner = (by: string): CurrentPage["owner"] =>
    by === "system" ? { kind: "system" } : by.startsWith("teammate:") ? { kind: "teammate", name: names.get(by.slice(9)) ?? "?" } : { kind: "owner" };
  const current: CurrentPage = {
    id: page.id,
    title: page.title,
    section: page.section,
    kind: page.kind,
    key: page.key,
    parentId: page.parentId && byId.has(page.parentId) ? page.parentId : null,
    icon: pageIcon(page),
    cover: page.cover,
    pending: pending.filter((s) => s.pageId === page.id).length,
    body: page.body,
    blocks: page.blocks ?? null,
    // Rewritten elsewhere (blocks dropped): the editor reloads when this changes.
    externalStamp: page.blocks ? null : createHash("sha1").update(page.body).digest("hex").slice(0, 12),
    owner: owner(page.createdBy),
    lastCheckedAt: page.lastCheckedAt?.toISOString() ?? null,
    stale: isStale(page),
  };
  const library = listLibrary(id);
  const counts = new Map<string, number>();
  for (const s of pending) if (s.pageId && s.pageId !== page.id) counts.set(s.pageId, (counts.get(s.pageId) ?? 0) + 1);
  return (
    <>
      <LiveRefresh businessId={id} types={["context_suggested", "context_decided"]} />
      <PageView
        key={page.id}
        businessId={id}
        page={current}
        ancestors={ancestors}
        mates={mateViews}
        readers={readersFor(page, mates, rows)}
        suggestions={[
          ...pending.filter((s) => s.pageId === page.id).map((s) => suggestionView(s, page, names, managerId)),
          ...pending.filter((s) => s.kind === "new_page").map((s) => suggestionView(s, undefined, names, managerId)),
        ]}
        otherPending={[...counts].filter(([pid]) => byId.has(pid)).map(([pid, count]) => ({ pageId: pid, title: byId.get(pid)!.title, count }))}
        usage={{ runs: usage?.runs ?? 0, fetched: usage?.fetched ?? 0, byTeammate: [...(usage?.byTeammate ?? new Map()).entries()].map(([tid, count]) => ({ id: tid, count })) }}
        contactsCount={page.kind === "database" ? listContacts(id).length : 0}
        size={promptSize(page)}
        history={pageHistory(id, page.id, names)}
        covers={coverImages(id, library)}
        editor={{
          businessId: id,
          pages: pages.filter((p) => p.id !== page.id).map((p) => ({ id: p.id, title: p.title })),
          contacts: mentionContacts(id),
          assets: galleryAssets(id, library),
        }}
      />
    </>
  );
}
