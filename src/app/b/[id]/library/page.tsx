import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listLibrary } from "@/lib/assets";
import { getBusiness, listTeammates } from "@/lib/data";
import { listLibraryViews } from "@/lib/library-views";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { Library } from "./library";

export default function LibraryPage(props: PageProps<"/b/[id]/library">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton shape="gallery" />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/library">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  const mates = (await listTeammates(id)).filter((t) => t.kind === "ai").map((t) => ({ id: t.id, name: t.name, title: t.title }));
  // The owner's media/ plus what the team made (work/images/, work/videos/).
  return <Library businessId={id} items={listLibrary(id, { team: true })} views={listLibraryViews(id)} teammates={mates} />;
}
