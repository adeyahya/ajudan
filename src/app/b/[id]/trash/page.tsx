import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState, PageBody, PageHeader, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { t } from "@/lib/i18n";

/** Trash: deleted docs, library files and contacts, to restore or purge (src/lib/trash.ts). A shell for now. */
export default function TrashPage(props: PageProps<"/b/[id]/trash">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/trash">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = business.language;
  return (
    <PageBody width="wide">
      <PageHeader title={t(lang, "nav.trash")} />
      <EmptyState icon={<Trash2 />} title={t(lang, "workspace.trash.emptyTitle")} body={t(lang, "workspace.trash.emptyBody")} />
    </PageBody>
  );
}
