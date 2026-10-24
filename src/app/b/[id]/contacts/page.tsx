import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq, like, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { LiveRefresh } from "@/components/live";
import { PageBody, Skeleton, TableSkeleton } from "@/components/kit";
import { listContacts } from "@/lib/contacts";
import { getBusiness } from "@/lib/data";
import { contextBase } from "@/app/b/[id]/context/data";
import { People } from "./people";
import { VIEWS, type HistoryItem, type View } from "./shared";

/** Contacts (the address book; src/lib/contacts.ts): saved views, a table, and a person side peek (?c=). */
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
  const { c, view } = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const { mateViews, managerId } = await contextBase(id);
  const contacts = listContacts(id);
  const open = contacts.find((x) => x.id === c);
  return (
    <>
      <LiveRefresh businessId={id} types={["task_done", "task_started"]} />
      <People
        businessId={id}
        contacts={contacts.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() }))}
        view={VIEWS.includes(view as View) ? (view as View) : "all"}
        history={open ? { contactId: open.id, items: history(id, open.name, open.phone) } : null}
        mates={mateViews}
        managerId={managerId}
      />
    </>
  );
}

/** Tasks and WhatsApp watches that mention a contact (by name or number), newest first. */
function history(businessId: string, name: string, phone: string | null): HistoryItem[] {
  const words = [name, ...(phone ? [phone, phone.slice(-9)] : [])].filter((w) => w.trim().length > 2);
  if (!words.length) return [];
  const names = new Map(db.select({ id: schema.teammates.id, name: schema.teammates.name }).from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all().map((m) => [m.id, m.name]));
  const tasks = db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.businessId, businessId), or(...words.flatMap((w) => [like(schema.tasks.instructions, `%${w}%`), like(schema.tasks.result, `%${w}%`)]))))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(12)
    .all()
    .map((t): HistoryItem => ({ kind: "task", id: t.id, title: t.title, who: names.get(t.teammateId) ?? "", status: t.status, at: t.createdAt.toISOString(), href: `/b/${businessId}/teammates/${t.teammateId}` }));
  const watches = db
    .select()
    .from(schema.waWatches)
    .where(and(eq(schema.waWatches.businessId, businessId), or(...words.map((w) => like(schema.waWatches.name, `%${w}%`)), ...(phone ? [like(schema.waWatches.jid, `${phone}%`)] : []))))
    .orderBy(desc(schema.waWatches.createdAt))
    .limit(6)
    .all()
    .map((w): HistoryItem => ({ kind: "whatsapp", id: w.id, title: w.purpose || w.message.slice(0, 80), who: names.get(w.teammateId) ?? "", status: w.status, at: w.createdAt.toISOString(), href: null }));
  return [...tasks, ...watches].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
}
