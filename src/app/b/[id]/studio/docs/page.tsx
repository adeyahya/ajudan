import { notFound } from "next/navigation";
import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { PageSkeleton } from "@/components/kit";
import { listLibrary } from "@/lib/assets";
import { getBusiness, listTeammates } from "@/lib/data";
import { Docs } from "./docs";

export default function DocsPage(props: PageProps<"/b/[id]/studio/docs">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content {...props} />
    </Suspense>
  );
}

async function loadDocs(businessId: string) {
  await connection();
  return db.select().from(schema.deliverables).where(eq(schema.deliverables.businessId, businessId)).orderBy(desc(schema.deliverables.createdAt)).limit(500).all();
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/studio/docs">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const [docs, mates] = await Promise.all([loadDocs(id), listTeammates(id)]);
  const media = listLibrary(id)
    .filter((i) => i.kind !== "audio")
    .map((i) => ({ path: i.path, name: i.title || i.name, kind: i.kind }));
  const docId = typeof sp.doc === "string" ? sp.doc : undefined;
  return (
    <Docs
      key={docId ?? "new"}
      businessId={id}
      docs={docs}
      docId={docId}
      teammates={mates.map((m) => ({ id: m.id, name: m.name, title: m.title, kind: m.kind }))}
      media={media}
    />
  );
}
