import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TableSkeleton } from "@/components/kit";
import { withQuery } from "@/lib/url-query";

/** The address book lives in /b/[id]/contacts now. */
export default function StudioContactsPage(props: PageProps<"/b/[id]/studio/contacts">) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Redirect {...props} />
    </Suspense>
  );
}

async function Redirect({ params, searchParams }: PageProps<"/b/[id]/studio/contacts">) {
  const { id } = await params;
  redirect(withQuery(`/b/${id}/contacts`, await searchParams));
  return null;
}
