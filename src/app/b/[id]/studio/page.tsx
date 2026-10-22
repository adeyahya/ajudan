import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/kit";
import { listLibrary } from "@/lib/assets";
import { getBusiness, listTeammates } from "@/lib/data";
import { Library } from "./library";

export default function StudioLibraryPage(props: PageProps<"/b/[id]/studio">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/studio">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const mates = (await listTeammates(id)).filter((t) => t.kind === "ai").map((t) => ({ id: t.id, name: t.name, title: t.title }));
  return <Library businessId={id} items={listLibrary(id)} teammates={mates} />;
}
