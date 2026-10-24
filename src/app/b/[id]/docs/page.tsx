import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { listLibrary } from "@/lib/assets";
import { getBusiness, listTeammates } from "@/lib/data";
import { Docs, type DocsFilter } from "./docs";

export default function DocsPage(props: PageProps<"/b/[id]/docs">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton shape="docs" />}>
      <Content {...props} />
    </Suspense>
  );
}

/**
 * The latest 500 as list rows (with the start of the text for the search box), plus the
 * open one (?doc=, e.g. "Open as page" from Work) in full, wherever it is in the list.
 */
async function loadDocs(businessId: string, docId?: string) {
  await connection();
  const docs = db
    .select({
      id: schema.deliverables.id,
      title: schema.deliverables.title,
      kind: schema.deliverables.kind,
      status: schema.deliverables.status,
      teammateId: schema.deliverables.teammateId,
      excerpt: sql<string>`substr(${schema.deliverables.content}, 1, ${SEARCH_CHARS})`,
    })
    .from(schema.deliverables)
    .where(and(eq(schema.deliverables.businessId, businessId), isNull(schema.deliverables.deletedAt)))
    .orderBy(desc(schema.deliverables.createdAt))
    .limit(500)
    .all();
  const doc = docId ? db.select().from(schema.deliverables).where(and(eq(schema.deliverables.id, docId), eq(schema.deliverables.businessId, businessId), isNull(schema.deliverables.deletedAt))).get() : undefined;
  if (doc && !docs.some((d) => d.id === doc.id)) docs.push({ ...doc, excerpt: doc.content.slice(0, SEARCH_CHARS) });
  return { docs, doc };
}

/** How much of each doc the list's search box looks through. */
const SEARCH_CHARS = 600;

async function Content({ params, searchParams }: PageProps<"/b/[id]/docs">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const docId = typeof sp.doc === "string" ? sp.doc : undefined;
  const [{ docs, doc }, mates] = await Promise.all([loadDocs(id, docId), listTeammates(id)]);
  const media = listLibrary(id)
    .filter((i) => i.kind !== "audio")
    .map((i) => ({ path: i.path, name: i.title || i.name, kind: i.kind }));
  const filter: DocsFilter = sp.who === "mine" || sp.who === "team" ? sp.who : "all";
  return (
    <Docs
      key={docId ?? "new"}
      businessId={id}
      docs={docs}
      doc={doc}
      docId={docId}
      filter={filter}
      teammates={mates.map((m) => ({ id: m.id, name: m.name, title: m.title, kind: m.kind }))}
      media={media}
    />
  );
}
