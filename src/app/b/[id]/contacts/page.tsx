import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live";
import { PageBody, Skeleton, TableSkeleton } from "@/components/kit";
import { contactTimeline } from "@/lib/contact-timeline";
import { listSegments } from "@/lib/contact-segments";
import { listContacts } from "@/lib/contacts";
import { getBusiness } from "@/lib/data";
import { contextBase } from "@/app/b/[id]/context/data";
import { People } from "./people";
import { toRow, VIEWS, type View } from "./shared";

/** Contacts (the address book; src/lib/contacts.ts): views and saved segments, a table, and a person side peek (?c=) with their timeline. */
export default function PeoplePage(props: PageProps<"/b/[id]/contacts">) {
  return (
    <Suspense
      fallback={
        <PageBody width="wide">
          <Skeleton className="h-[34px] w-40 rounded-md" />
          <TableSkeleton rows={8} cols={5} className="mt-10" />
        </PageBody>
      }
    >
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: PageProps<"/b/[id]/contacts">["params"]; searchParams: PageProps<"/b/[id]/contacts">["searchParams"] }) {
  const { id } = await params;
  const { c, view, seg } = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const { mateViews, managerId } = await contextBase(id);
  const contacts = listContacts(id);
  const open = contacts.find((x) => x.id === c);
  const segments = listSegments(id).map(({ id: sid, name, kind, tags, text, followUp }) => ({ id: sid, name, kind, tags, text, followUp }));
  const segment = typeof seg === "string" ? segments.find((s) => s.id === seg) : undefined;
  return (
    <>
      <LiveRefresh businessId={id} types={["task_done", "task_started", "contact_saved", "contact_interaction", "contact_follow_up"]} />
      <People
        businessId={id}
        contacts={contacts.map(toRow)}
        view={segment ? "all" : VIEWS.includes(view as View) ? (view as View) : "all"}
        segments={segments}
        segmentId={segment?.id ?? null}
        timeline={open ? { contactId: open.id, items: contactTimeline(id, open.id, 40) } : null}
        mates={mateViews}
        managerId={managerId}
      />
    </>
  );
}
