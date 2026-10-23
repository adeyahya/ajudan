import fs from "node:fs";
import path from "node:path";
import { Eye } from "lucide-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SetBreadcrumb } from "@/components/breadcrumb";
import { LiveRefresh } from "@/components/live";
import { Avatar, EmptyState, LineTabs, PageBody, PageSkeleton, Prose, Section } from "@/components/kit";
import { contextPrompt, pageIcon, SECTIONS, usageThisWeek } from "@/lib/context";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
import { resolveWorkspace } from "@/lib/paths";
import { contextBase, promptLoad, readersFor } from "../data";
import { LensColumns, PromptText, type LensCard } from "./columns";
import { LoadBar, TestAsk } from "./readers";

/**
 * Team view: exactly what one teammate starts every task with. Three columns (always in
 * the prompt, read when needed, never) to drag pages between, the prompt text as sent,
 * then its latest run's context, its memory, and a dry-run question.
 */
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
  if (!mate) {
    return (
      <PageBody>
        <EmptyState icon={<Eye />} title={t(lang, "context.tab.readers")} body={t(lang, "context.notActive")} />
      </PageBody>
    );
  }

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
  const load = promptLoad(id, mate.id);
  const inPrompt = new Map(load.items.map((i) => [i.id, i]));
  const usage = usageThisWeek(id);
  const cards: LensCard[] = sorted.map((p) => {
    const item = inPrompt.get(p.id);
    const mode = modes.get(p.id)!;
    return {
      id: p.id,
      title: p.title,
      kind: p.kind,
      icon: pageIcon(p),
      // The address book is never in the prompt, only searched: it shows under "when needed".
      mode: p.kind === "database" && mode === "always" ? "when_needed" : mode,
      chars: item?.chars ?? 0,
      cut: !!item?.truncated && item.chars > 0,
      left: !!item?.truncated && item.chars === 0,
      runs: usage.get(p.id)?.byTeammate.get(mate.id) ?? 0,
    };
  });
  const prompt = contextPrompt(id, mate.id).prompt;

  return (
    <PageBody width="wide">
      <LiveRefresh businessId={id} types={["context_ask_done", "task_started", "task_done", "context_decided"]} />
      <SetBreadcrumb items={[{ label: t(lang, "context.tab.readers"), href: `/b/${id}/context/readers` }, { label: mate.name }]} />
      <header className="mb-6">
        <Eye aria-hidden className="mb-3 size-8 text-foreground" strokeWidth={1.5} />
        <h1 className="text-[28px] leading-[34px] font-bold tracking-tight">{t(lang, "context.tab.readers")}</h1>
        <p className="mt-1.5 max-w-[60ch] text-sm leading-[22px] text-muted-foreground">{t(lang, "context.readers.help")}</p>
      </header>
      <LineTabs
        label={t(lang, "context.tab.readers")}
        className="mb-8"
        items={mates.map((m) => ({
          href: `/b/${id}/context/readers?t=${m.id}`,
          label: m.name,
          active: m.id === mate.id,
          icon: <Avatar seed={m.id} name={m.name} color={m.color} size={20} />,
        }))}
      />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <LensColumns businessId={id} teammateId={mate.id} name={mate.name} cards={cards} used={load.used} total={load.total} />
        <PromptText name={mate.name} text={prompt} />
      </div>

      <div className="mt-12 grid gap-x-12 gap-y-8 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Section title={t(lang, "context.readers.title", { name: mate.name })} description={task ? t(lang, "context.readers.latest", { title: task.title }) : undefined}>
            {task ? (
              <LoadBar loads={loads.map((l) => ({ id: String(l.id), label: l.label, mode: l.mode, chars: l.chars, truncated: l.truncated, pageId: l.pageId }))} businessId={id} />
            ) : (
              <p className="text-[13px] text-muted-foreground">{t(lang, "context.readers.noTask", { name: mate.name })}</p>
            )}
          </Section>

          <Section title={t(lang, "context.readers.memory", { name: mate.name })}>
            {memory.trim() ? (
              <div className="max-h-96 overflow-y-auto rounded-lg bg-muted p-4">
                <Prose className="text-[13px]">{memory}</Prose>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t(lang, "context.readers.noMemory")}</p>
            )}
          </Section>
        </div>

        <aside className="min-w-0">
          <TestAsk
            businessId={id}
            mate={{ id: mate.id, name: mate.name, color: mate.color }}
            asks={asks.map((a) => ({ id: a.id, question: a.question, answer: a.answer, cited: a.cited, status: a.status }))}
            pageIds={Object.fromEntries(pages.map((p) => [p.title.toLowerCase(), p.id]))}
          />
        </aside>
      </div>
    </PageBody>
  );
}
