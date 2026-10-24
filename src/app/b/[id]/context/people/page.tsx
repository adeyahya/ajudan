import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TableSkeleton } from "@/components/kit";
import { withQuery } from "@/lib/url-query";

/** Konteks → People moved to /b/[id]/contacts (?c= and ?view= carry over). */
export default function ContextPeoplePage(props: PageProps<"/b/[id]/context/people">) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Redirect {...props} />
    </Suspense>
  );
}

async function Redirect({ params, searchParams }: PageProps<"/b/[id]/context/people">) {
  const { id } = await params;
  redirect(withQuery(`/b/${id}/contacts`, await searchParams));
  return null;
}
