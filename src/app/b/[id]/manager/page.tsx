import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/kit";

/** The manager's conversation is the business home now: /b/[id], with the office above it. */
export default function ManagerPage(props: PageProps<"/b/[id]/manager">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/manager">["params"] }): Promise<never> {
  const { id } = await params;
  redirect(`/b/${id}`);
}
