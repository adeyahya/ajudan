import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EmptyState, LineTabs, PageBody, PageHeader, PageSkeleton } from "@/components/kit";
import { LiveRefresh } from "@/components/live";
import { ObjectTypeIcon } from "@/components/object-type-icon";
import { actorLabel, typeLabel } from "@/components/workspace-labels";
import { getBusiness } from "@/lib/data";
import { t, uiLang, type MessageKey } from "@/lib/i18n";
import { actorResolver } from "@/lib/object-history";
import { listTrash, TRASH_TYPES, type TrashType } from "@/lib/trash";
import { fullTime, relativeTime } from "../deliverables/format";
import { EmptyTrashButton, TrashList, type TrashRow } from "./trash-list";

/**
 * Trash: deleted docs, Context pages, library files and contacts (src/lib/trash.ts), to
 * restore or delete forever, filtered by type (`?type=`). The worker deletes items that
 * have been here more than 30 days (worker/maintenance.ts).
 */
export default function TrashPage(props: PageProps<"/b/[id]/trash">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function loadTrash(businessId: string) {
  await connection();
  const actor = actorResolver(businessId);
  return { items: listTrash(businessId).map((i) => ({ ...i, actor: actor(i.deletedBy) })), now: Date.now() };
}

async function Content({ params, searchParams }: Pick<PageProps<"/b/[id]/trash">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = uiLang(business.language);
  const tr = (key: MessageKey) => t(lang, key);
  const { items, now } = await loadTrash(id);
  const type = (TRASH_TYPES as string[]).includes(String(sp.type)) ? (sp.type as TrashType) : undefined;
  const rows: TrashRow[] = items
    .filter((i) => !type || i.type === type)
    .map((i) => ({
      type: i.type,
      id: i.id,
      title: i.title || "—",
      when: relativeTime(i.deletedAt, lang, now),
      whenFull: fullTime(i.deletedAt, lang),
      who: actorLabel(tr, i.actor),
    }));
  const base = `/b/${id}/trash`;

  return (
    <PageBody width="wide">
      <LiveRefresh businessId={id} stepsOf="-" />
      <PageHeader
        title={t(lang, "nav.trash")}
        description={t(lang, "workspace.trash.description")}
        actions={items.length > 0 ? <EmptyTrashButton businessId={id} /> : undefined}
      />
      {items.length === 0 ? (
        <EmptyState icon={<Trash2 />} title={t(lang, "workspace.trash.emptyTitle")} body={t(lang, "workspace.trash.emptyBody")} />
      ) : (
        <>
          <LineTabs
            className="mb-4"
            label={t(lang, "nav.trash")}
            items={[
              { href: base, label: t(lang, "workspace.trash.all"), active: !type, count: items.length },
              ...TRASH_TYPES.map((ty) => ({
                href: `${base}?type=${ty}`,
                label: typeLabel(tr, ty),
                active: type === ty,
                count: items.filter((i) => i.type === ty).length,
                icon: <ObjectTypeIcon type={ty} className="text-current" />,
              })),
            ]}
          />
          {rows.length ? (
            <TrashList key={type ?? "all"} businessId={id} rows={rows} />
          ) : (
            <p className="py-6 text-center text-[13px] text-tertiary">{t(lang, "workspace.trash.noneOfType")}</p>
          )}
        </>
      )}
    </PageBody>
  );
}
