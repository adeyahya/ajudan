import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { listLibrary } from "@/lib/assets";
import { getBusiness, listTeammates } from "@/lib/data";
import { listDocItems, mentionCandidates, searchDocKeys } from "@/lib/docs";
import { parseDocsFilter } from "@/lib/docs-list";
import { Docs } from "./docs";

export default function DocsPage(props: PageProps<"/b/[id]/docs">) {
  return (
    <Suspense fallback={<WorkspaceSkeleton shape="docs" />}>
      <Content {...props} />
    </Suspense>
  );
}

/**
 * Docs: saved work (deliverables) and Context pages in one list, filtered by the URL
 * (?who, ?status, ?folder, ?q). ?doc=<id> opens a deliverable in the editor ("Open as
 * page" from Work, links, mentions); ?new=blank or ?new=<template> starts a new one.
 */
async function loadDocs(businessId: string, q: string, docId?: string) {
  await connection();
  const items = listDocItems(businessId);
  const matches = searchDocKeys(businessId, q);
  const doc = docId
    ? db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, docId), eq(schema.deliverables.businessId, businessId), isNull(schema.deliverables.deletedAt)))
        .get()
    : undefined;
  return { items, matches: matches ? [...matches] : null, doc };
}

async function Content({ params, searchParams }: PageProps<"/b/[id]/docs">) {
  const { id } = await params;
  const sp = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const filter = parseDocsFilter(sp);
  const docId = typeof sp.doc === "string" ? sp.doc : undefined;
  const newDoc = typeof sp.new === "string" ? sp.new : undefined;
  const [{ items, matches, doc }, mates] = await Promise.all([loadDocs(id, filter.q, docId), listTeammates(id)]);
  const editing = !!doc || newDoc !== undefined;
  const library = editing ? listLibrary(id).map((i) => ({ path: i.path, name: i.title || i.name, kind: i.kind })) : [];
  return (
    <Docs
      key={doc?.id ?? (newDoc !== undefined ? `new:${newDoc}` : "list")}
      businessId={id}
      items={items}
      matches={matches}
      filter={filter}
      doc={doc}
      newTemplate={doc ? undefined : newDoc}
      teammates={mates.map((m) => ({ id: m.id, name: m.name, title: m.title, kind: m.kind }))}
      media={library.filter((i) => i.kind !== "audio")}
      candidates={editing ? mentionCandidates(id, library) : []}
    />
  );
}
