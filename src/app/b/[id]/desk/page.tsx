import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MessageCircle } from "lucide-react";
import { Button, EmptyState, ListSkeleton, PageBody, Skeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { deskScore, deskSummaries } from "@/lib/desk";
import { t } from "@/lib/i18n";
import { restFor } from "@/lib/rest";
import { isLinked } from "@/lib/whatsapp";
import { Desk } from "./desk";

export default function DeskPage(props: PageProps<"/b/[id]/desk">) {
  return (
    <Suspense fallback={<DeskSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

/** The desk fills the viewport under the top bar (and above the phone's bottom bar). */
const FILL = "h-[calc(100dvh-var(--topbar-h)-var(--bottombar-h)-env(safe-area-inset-bottom))] px-0 pt-0 pb-0 sm:px-0 sm:pt-0";

function DeskSkeleton() {
  return (
    <PageBody width="full" className={FILL}>
      <div className="flex h-9 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="grid h-[calc(100%-36px)] md:grid-cols-[300px_minmax(0,1fr)]">
        <ListSkeleton rows={8} className="border-r border-border p-2" />
        <div className="hidden bg-muted/40 md:block" />
      </div>
    </PageBody>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/desk">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = business.language;
  if (!(await isLinked())) {
    return (
      <PageBody>
        <EmptyState
          icon={<MessageCircle />}
          title={t(lang, "desk.notLinkedTitle")}
          body={t(lang, "desk.notLinkedBody")}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/b/${id}/profile`}>{t(lang, "desk.notLinkedAction")}</Link>
            </Button>
          }
        />
      </PageBody>
    );
  }
  const chats = await deskSummaries(id).catch(() => []);
  return (
    <PageBody width="full" className={FILL}>
      <Desk businessId={id} language={business.language} initial={{ chats, score: deskScore(id), rest: restFor(id) }} />
    </PageBody>
  );
}
