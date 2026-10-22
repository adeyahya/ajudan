import { Suspense } from "react";
import { Skeleton } from "@/components/kit";
import { ContextSidebar } from "./context-tree";
import { treePages } from "./data";

/**
 * Konteks (src/lib/context.ts): pages the team reads, the address book as a database,
 * and what each teammate actually reads. Two panes under the top bar, like Notion: the
 * page tree on the left (its own scroll; a Sheet on narrow screens), the page on the
 * right. Nothing here calls Claude except the readers' test question (the worker answers).
 *
 * `data-page-body` turns off the business shell's old padded frame for every route here.
 */
export default function ContextLayout({ children, params }: LayoutProps<"/b/[id]/context">) {
  return (
    <div data-page-body="full" className="flex min-h-[calc(100dvh-var(--topbar-h))] w-full">
      <Suspense fallback={<TreeSkeleton />}>
        <Tree params={params} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

async function Tree({ params }: { params: LayoutProps<"/b/[id]/context">["params"] }) {
  const { id } = await params;
  const pages = await treePages(id);
  return <ContextSidebar businessId={id} pages={pages} />;
}

function TreeSkeleton() {
  return (
    <div className="sticky top-(--topbar-h) hidden h-[calc(100dvh-var(--topbar-h))] w-[260px] shrink-0 border-r border-border px-3 pt-3 lg:block" aria-busy>
      <Skeleton className="h-7 w-full rounded-md" />
      <div className="mt-5 space-y-2.5">
        {[70, 55, 80, 45, 62, 50].map((w, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
