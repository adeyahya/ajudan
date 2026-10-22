import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TableSkeleton } from "@/components/kit";

/** The address book lives in Konteks → People now (with import and export in its "…" menu). */
export default function ContactsPage(props: PageProps<"/b/[id]/studio/contacts">) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Redirect params={props.params} />
    </Suspense>
  );
}

async function Redirect({ params }: { params: PageProps<"/b/[id]/studio/contacts">["params"] }) {
  const { id } = await params;
  redirect(`/b/${id}/context/people`);
  return null;
}
