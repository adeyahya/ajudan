import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { StudioSkeleton } from "../_components/studio-skeleton";
import { listLibrary } from "@/lib/assets";
import { getBusiness, listTeammates } from "@/lib/data";
import { Docs, type DocsFilter } from "./docs";

export default function DocsPage(props: PageProps<"/b/[id]/studio/docs">) {
  return (
    <Suspense fallback={<StudioSkeleton shape="docs" />}>
      <Content {...props} />
    </Suspense>
  );
}

/** The latest 500, plus the one asked for (?doc=, e.g. "Open as page" from Work) when it's older. */
async function loadDocs(businessId: string, docId?: string) {
  await connection();
  const docs = db.select().from(schema.deliverables).where(eq(schema.deliverables.businessId, businessId)).orderBy(desc(schema.deliverables.createdAt)).limit(500).all();
  if (docId && !docs.some((d) => d.id === docId)) {
    const doc = db.select().from(schema.deliverables).where(and(eq(schema.deliverables.id, docId), eq(schema.deliverables.businessId, businessId))).get();
    if (doc) docs.push(doc);
  }
  return docs;
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/studio/docs">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const docId = typeof sp.doc === "string" ? sp.doc : undefined;
  const [docs, mates] = await Promise.all([loadDocs(id, docId), listTeammates(id)]);
  const media = listLibrary(id)
    .filter((i) => i.kind !== "audio")
    .map((i) => ({ path: i.path, name: i.title || i.name, kind: i.kind }));
  const filter: DocsFilter = sp.who === "mine" || sp.who === "team" ? sp.who : "all";
  return (
    <Docs
      key={docId ?? "new"}
      businessId={id}
      docs={docs}
      docId={docId}
      filter={filter}
      teammates={mates.map((m) => ({ id: m.id, name: m.name, title: m.title, kind: m.kind }))}
      media={media}
    />
  );
}
