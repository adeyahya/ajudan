import { Suspense } from "react";
import { PageSkeleton } from "@/components/kit";
import { TeammateView } from "./teammate-view";

type Params = { params: Promise<{ id: string; tid: string }> };

export default function TeammatePage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: Params) {
  const { id, tid } = await params;
  return <TeammateView id={id} tid={tid} />;
}
