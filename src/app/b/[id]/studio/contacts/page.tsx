import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/kit";
import { listContacts } from "@/lib/contacts";
import { getBusiness } from "@/lib/data";
import { Contacts } from "./contacts";

export default function ContactsPage(props: PageProps<"/b/[id]/studio/contacts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/studio/contacts">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  await connection();
  return <Contacts businessId={id} contacts={listContacts(id)} />;
}
