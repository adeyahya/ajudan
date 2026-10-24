import { redirect } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { withQuery } from "@/lib/url-query";

/** The library moved to /b/[id]/library; the Studio keeps the video and audio editors. */
export default function StudioPage(props: PageProps<"/b/[id]/studio">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton shape="gallery" />}>
      <Redirect {...props} />
    </Suspense>
  );
}

async function Redirect({ params, searchParams }: PageProps<"/b/[id]/studio">) {
  const { id } = await params;
  redirect(withQuery(`/b/${id}/library`, await searchParams));
  return null;
}
