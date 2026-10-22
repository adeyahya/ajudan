import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { OfficeShell } from "./office-shell";
import { loadOffice } from "./state";

/** The full office: the pixel room, the roster and the live activity feed. */
export default function OfficePage(props: PageProps<"/b/[id]/office">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/b/[id]/office">["params"] }) {
  const { id } = await params;
  const business = await getBusiness(id);
  if (!business) notFound();
  // Before the team is hired there's no office yet: the business home says what's next.
  if (business.status !== "active") redirect(`/b/${id}`);
  const { state, events, now } = await loadOffice(id);
  return (
    <OfficeShell businessId={id} businessName={business.name} initialState={state} initialEvents={events} initialNow={now} />
  );
}
