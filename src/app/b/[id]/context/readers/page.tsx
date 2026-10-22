import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { LiveRefresh } from "@/components/live";
import { Avatar, Card, PageSkeleton, Prose, cn } from "@/components/kit";
import { SECTIONS } from "@/lib/context";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
import { resolveWorkspace } from "@/lib/paths";
import { contextBase, readersFor } from "../data";
import { LoadBar, PageModes, TestAsk } from "./readers";

/** K3: what a teammate reads (its latest task), how each page reaches it, and a dry-run question. */
export default function ReadersPage(props: PageProps<"/b/[id]/context/readers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: PageProps<"/b/[id]/context/readers">["params"]; searchParams: PageProps<"/b/[id]/context/readers">["searchParams"] }) {
  const { id } = await params;
  const { t: wanted } = await searchParams;
  const business = await getBusiness(id);
  if (!business) notFound();
  const lang = uiLang(business.language);
  const { pages, rows, mates } = await contextBase(id);
  const mate = mates.find((m) => m.id === wanted) ?? mates[0];
  if (!mate) return <Card className="p-6 text-sm text-muted-foreground">{t(lang, "context.notActive")}</Card>;

  const last = db
    .select({ taskId: schema.contextLoads.taskId })
    .from(schema.contextLoads)
    .where(and(eq(schema.contextLoads.businessId, id), eq(schema.contextLoads.teammateId, mate.id)))
    .orderBy(desc(schema.contextLoads.id))
    .get();
  const task = last ? db.select({ title: schema.tasks.title }).from(schema.tasks).where(eq(schema.tasks.id, last.taskId)).get() : undefined;
  const loads = last ? db.select().from(schema.contextLoads).where(eq(schema.contextLoads.taskId, last.taskId)).orderBy(schema.contextLoads.id).all() : [];
  let memory = "";
  try {
    if (mate.workspaceDir) memory = fs.readFileSync(path.join(resolveWorkspace(mate.workspaceDir), "memory.md"), "utf8");
  } catch {
    // never ran
  }
  const asks = db
    .select()
    .from(schema.contextAsks)
    .where(and(eq(schema.contextAsks.businessId, id), eq(schema.contextAsks.teammateId, mate.id)))
    .orderBy(desc(schema.contextAsks.createdAt))
    .limit(5)
    .all();
  const order = (s: string) => SECTIONS.indexOf(s as (typeof SECTIONS)[number]);
  const sorted = [...pages].sort((a, b) => order(a.section) - order(b.section) || a.sortOrder - b.sortOrder);
  const modes = new Map(sorted.map((p) => [p.id, readersFor(p, [mate], rows)[0].mode]));

  return (
    <div className="space-y-4">
      <LiveRefresh businessId={id} types={["context_ask_done", "task_started", "task_done"]} />
      <div className="flex flex-wrap gap-1.5">
        {mates.map((m) => (
          <Link
            key={m.id}
            href={`/b/${id}/context/readers?t=${m.id}`}
            className={cn(
              "font-pixel flex items-center gap-1.5 rounded-[3px] border-2 border-frame px-2 py-0.5 text-sm",
              m.id === mate.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            <Avatar seed={m.id} name={m.name} color={m.color} size={18} />
            {m.name}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3 p-4">
            <h2 className="font-pixel text-lg text-primary">{t(lang, "context.readers.title", { name: mate.name })}</h2>
            <p className="text-xs text-muted-foreground">{t(lang, "context.readers.help")}</p>
            {task ? (
              <>
                <p className="text-sm">{t(lang, "context.readers.latest", { title: task.title })}</p>
                <LoadBar loads={loads.map((l) => ({ id: String(l.id), label: l.label, mode: l.mode, chars: l.chars, truncated: l.truncated, pageId: l.pageId }))} businessId={id} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t(lang, "context.readers.noTask", { name: mate.name })}</p>
            )}
          </Card>

          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">{t(lang, "context.readers.pages", { name: mate.name })}</h2>
            <PageModes businessId={id} teammateId={mate.id} pages={sorted.map((p) => ({ id: p.id, title: p.title, section: p.section, mode: modes.get(p.id)! }))} />
          </Card>

          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">{t(lang, "context.readers.memory", { name: mate.name })}</h2>
            {memory.trim() ? <Prose className="max-h-72 overflow-y-auto text-xs">{memory}</Prose> : <p className="text-xs text-muted-foreground">{t(lang, "context.readers.noMemory")}</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <TestAsk
            businessId={id}
            mate={{ id: mate.id, name: mate.name }}
            asks={asks.map((a) => ({ id: a.id, question: a.question, answer: a.answer, cited: a.cited, status: a.status }))}
            pageIds={Object.fromEntries(pages.map((p) => [p.title.toLowerCase(), p.id]))}
          />
          <Card className="space-y-1 p-4">
            <h2 className="text-sm font-semibold">{t(lang, "context.readers.conflicts")}</h2>
            <p className="text-xs text-muted-foreground">{t(lang, "context.readers.conflictsNone")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
