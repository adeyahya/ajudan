import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card, PageHeader, PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { deskScore, deskSummaries } from "@/lib/desk";
import { readRest } from "@/lib/rest";
import { isLinked } from "@/lib/whatsapp";
import { Desk } from "./desk";

export default function DeskPage(props: PageProps<"/b/[id]/desk">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/desk">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const header = (
    <PageHeader
      title="Customer Desk"
      subtitle="Take a shift as customer service: answer WhatsApp chats yourself. It costs no Claude usage, so it works while the team rests, and the team won't answer what you already did."
    />
  );
  if (!(await isLinked())) {
    return (
      <div>
        {header}
        <Card className="max-w-xl p-6 text-sm">
          The business&apos;s WhatsApp isn&apos;t linked yet.{" "}
          <Link href={`/b/${id}/profile`} className="text-primary hover:underline">
            Link it on the Business page →
          </Link>
        </Card>
      </div>
    );
  }
  const chats = await deskSummaries(id).catch(() => []);
  return (
    <div>
      {header}
      <Desk businessId={id} language={business.language} initial={{ chats, score: deskScore(id), rest: readRest() }} />
    </div>
  );
}
