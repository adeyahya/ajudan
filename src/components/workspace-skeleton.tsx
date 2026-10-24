import { CardGridSkeleton, EditorSkeleton, ListSkeleton, PageBody, Skeleton } from "@/components/kit";

/**
 * Loading states for the workspace pages and the Studio editors, shaped like the page that
 * is coming (title, the Studio's tabs when `tabs`, then the body).
 */
export function WorkspaceSkeleton({ shape, tabs = false }: { shape: "gallery" | "docs" | "editor"; tabs?: boolean }) {
  return (
    <PageBody width="full">
      <Skeleton className="h-[34px] w-40 rounded-md" />
      {tabs && (
        <div className="mt-5 flex h-8 items-end gap-4 border-b border-border pb-2">
          {[52, 52].map((w, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
      )}
      <div className={tabs ? "mt-6" : "mt-5"}>
        {shape === "gallery" ? (
          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="hidden space-y-2 lg:block">
              <Skeleton className="h-7 w-full rounded-md" />
              <ListSkeleton rows={4} />
            </div>
            <CardGridSkeleton count={10} />
          </div>
        ) : shape === "docs" ? (
          <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
            <ListSkeleton rows={7} className="hidden lg:block" />
            <EditorSkeleton className="mx-0" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Skeleton className="h-[56vh] w-full rounded-lg" />
            <ListSkeleton rows={5} />
          </div>
        )}
      </div>
    </PageBody>
  );
}
