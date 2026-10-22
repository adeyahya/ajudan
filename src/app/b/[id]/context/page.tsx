import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live";
import { PageSkeleton } from "@/components/kit";
import { listContacts } from "@/lib/contacts";
import { SECTIONS, usageThisWeek } from "@/lib/context";
import { getBusiness } from "@/lib/data";
import { contextBase, galleryAssets, mentionContacts, pendingFor, readersFor, suggestionView } from "./data";
import { ContextWorkspace, type CurrentPage, type PageSummary } from "./workspace";

/** K1: the page tree, one page in the editor, and the team's suggestions, readers and usage. */
export default function ContextPage(props: PageProps<"/b/[id]/context">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: PageProps<"/b/[id]/context">["params"]; searchParams: PageProps<"/b/[id]/context">["searchParams"] }) {
  const { id } = await params;
  const { page: wanted } = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const { pages, rows, mates, mateViews, managerId } = await contextBase(id);
  const pending = pendingFor(id);
  const order = (p: (typeof pages)[number]) => SECTIONS.indexOf(p.section) * 1e6 + p.sortOrder;
  const page = pages.find((p) => p.id === wanted) ?? [...pages].sort((a, b) => order(a) - order(b))[0];
  const names = new Map(mates.map((m) => [m.id, m.name]));
  const usage = page ? usageThisWeek(id).get(page.id) : undefined;
  const summaries: PageSummary[] = pages.map((p) => ({
    id: p.id,
    title: p.title,
    section: p.section,
    kind: p.kind,
    key: p.key,
    parentId: p.parentId,
    pending: pending.filter((s) => s.pageId === p.id).length,
  }));
  const owner = (by: string): CurrentPage["owner"] =>
    by === "system" ? { kind: "system" } : by.startsWith("teammate:") ? { kind: "teammate", name: names.get(by.slice(9)) ?? "?" } : { kind: "owner" };
  const current: CurrentPage | null = page
    ? {
        ...summaries.find((s) => s.id === page.id)!,
        body: page.body,
        blocks: page.blocks ?? null,
        // Rewritten elsewhere (blocks dropped): the editor reloads when this changes.
        externalStamp: page.blocks ? null : createHash("sha1").update(page.body).digest("hex").slice(0, 12),
        owner: owner(page.createdBy),
        lastCheckedAt: page.lastCheckedAt?.toISOString() ?? null,
      }
    : null;
  const byId = new Map(pages.map((p) => [p.id, p]));
  return (
    <>
      <LiveRefresh businessId={id} types={["context_suggested", "context_decided"]} />
      <ContextWorkspace
        businessId={id}
        pages={summaries}
        current={current}
        mates={mateViews}
        readers={page ? readersFor(page, mates, rows) : []}
        suggestions={page ? pending.filter((s) => s.pageId === page.id).map((s) => suggestionView(s, page, names, managerId)) : []}
        newPageSuggestions={pending.filter((s) => s.kind === "new_page").map((s) => suggestionView(s, undefined, names, managerId))}
        otherPending={summaries.filter((s) => s.pending > 0 && s.id !== page?.id).map((s) => ({ pageId: s.id, title: byId.get(s.id)!.title, count: s.pending }))}
        usage={{ runs: usage?.runs ?? 0, fetched: usage?.fetched ?? 0, byTeammate: [...(usage?.byTeammate ?? new Map()).entries()].map(([tid, count]) => ({ id: tid, count })) }}
        contactsCount={page?.kind === "database" ? listContacts(id).length : 0}
        editor={{
          businessId: id,
          pages: pages.filter((p) => p.id !== page?.id).map((p) => ({ id: p.id, title: p.title })),
          contacts: mentionContacts(id),
          assets: galleryAssets(id),
        }}
      />
    </>
  );
}
