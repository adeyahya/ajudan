import { House } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState, PageBody, PageHeader, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { t } from "@/lib/i18n";

/**
 * Home: recent docs, new from the team, starred items, follow-ups due and pending
 * approvals (docs/HYBRID-PLAN.md, Phase 0). A shell for now.
 */
export default function HomePage(props: PageProps<"/b/[id]/home">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/home">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = business.language;
  return (
    <PageBody width="wide">
      <PageHeader title={t(lang, "nav.home")} />
      <EmptyState icon={<House />} title={t(lang, "workspace.home.emptyTitle")} body={t(lang, "workspace.home.emptyBody")} />
    </PageBody>
  );
}
