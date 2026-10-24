import { redirect } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { withQuery } from "@/lib/url-query";

/** Docs moved to /b/[id]/docs (?doc= and ?who= carry over). */
export default function StudioDocsPage(props: PageProps<"/b/[id]/studio/docs">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton shape="docs" />}>
      <Redirect {...props} />
    </Suspense>
  );
}

async function Redirect({ params, searchParams }: PageProps<"/b/[id]/studio/docs">) {
  const { id } = await params;
  redirect(withQuery(`/b/${id}/docs`, await searchParams));
  return null;
}
