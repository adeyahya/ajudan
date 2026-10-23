import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq, inArray, isNotNull, like, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { CircleDot, Clock, FolderCheck, Image as ImageIcon, Radio, Tag, Type, User, X } from "lucide-react";
import { db, schema } from "@/db";
import type { Deliverable, DeliverableStatus } from "@/db/schema";
import { LiveRefresh } from "@/components/live";
import { DataTable } from "@/components/data-table";
import { SidePeekLayout } from "@/components/side-peek";
import { ImageStrip } from "@/components/image-strip";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  LineTabs,
  PageBody,
  PageHeader,
  Prose,
  Skeleton,
  TableSkeleton,
  type LineTab,
} from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { statusTone } from "@/lib/status-tones";
import { t, tn, uiLang, type UiLang } from "@/lib/i18n";
import { CopyButton } from "./copy-button";
import { DeliverablePeek, MarkPostedButton } from "./deliverable-peek";
import { FeedbackForm } from "./feedback-form";
import { fullTime, kindLabel, relativeTime, updatedAt } from "./format";
import { WorkFilters, WorkSearch } from "./work-toolbar";

type Props = PageProps<"/b/[id]/deliverables">;

const STATUSES: DeliverableStatus[] = ["draft", "ready_to_post", "approved", "published", "rejected"];

/** Saved views (line tabs) → the existing `?status=` param. */
const VIEWS = [
  { key: "work.view.all", status: undefined },
  { key: "work.view.needsYou", status: "ready_to_post" },
  { key: "work.view.drafts", status: "draft" },
  { key: "work.view.posted", status: "published" },
] as const;

export default function DeliverablesPage(props: Props) {
  return (
    <Suspense fallback={<WorkSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

function WorkSkeleton() {
  return (
    <PageBody width="wide">
      <Skeleton className="h-[34px] w-40 rounded-md" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <Skeleton className="mt-10 h-8 w-full max-w-md" />
      <TableSkeleton rows={8} cols={6} className="mt-4" />
    </PageBody>
  );
}

type Filters = { status?: string; kinds: string[]; teammates: string[]; q?: string };

async function loadDeliverables(businessId: string, f: Filters, peekId: string | undefined) {
  await connection();
  const base = eq(schema.deliverables.businessId, businessId);
  const where: SQL[] = [base];
  if (f.status && STATUSES.includes(f.status as DeliverableStatus))
    where.push(eq(schema.deliverables.status, f.status as DeliverableStatus));
  if (f.kinds.length) where.push(inArray(schema.deliverables.kind, f.kinds));
  if (f.teammates.length) where.push(inArray(schema.deliverables.teammateId, f.teammates));
  if (f.q) where.push(like(schema.deliverables.title, `%${f.q}%`));
  const rows = db
    .select()
    .from(schema.deliverables)
    .where(and(...where))
    .orderBy(desc(schema.deliverables.createdAt))
    .limit(300)
    .all();
  // Counts for the view tabs (status only; the other filters narrow the table, not the tabs).
  const counts = new Map<string, number>();
  for (const r of db.select({ status: schema.deliverables.status }).from(schema.deliverables).where(base).all())
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const kinds = db
    .selectDistinct({ kind: schema.deliverables.kind })
    .from(schema.deliverables)
    .where(base)
    .all()
    .map((k) => k.kind)
    .sort();
  const mates = db.select().from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all();
  // The peeked piece is loaded by id, so a search-result link opens it whatever the view.
  const peek = peekId
    ? (rows.find((r) => r.id === peekId) ??
      db.select().from(schema.deliverables).where(and(base, eq(schema.deliverables.id, peekId))).get())
    : undefined;
  // Pieces a teammate is revising right now (the owner's "Needs changes" or the manager's review).
  const revising = new Map(
    db
      .select({ deliverableId: schema.tasks.deliverableId, teammateId: schema.tasks.teammateId })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.businessId, businessId),
          isNotNull(schema.tasks.deliverableId),
          inArray(schema.tasks.status, ["queued", "running", "waiting_approval"]),
        ),
      )
      .all()
      .map((t) => [t.deliverableId!, mates.find((m) => m.id === t.teammateId)?.name ?? null] as const),
  );
  return { rows, counts, total: [...counts.values()].reduce((a, b) => a + b, 0), kinds, mates, revising, peek };
}

async function Content({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
  const f: Filters = { status: one(sp.status), kinds: all(sp.kind), teammates: all(sp.teammate), q: one(sp.q)?.trim() || undefined };
  const peekId = one(sp.d);
  const [biz, data] = await Promise.all([getBusiness(id), loadDeliverables(id, f, peekId)]);
  if (!biz) notFound();
  const lang = uiLang(biz.language);
  const mate = (tid: string | null) => (tid ? data.mates.find((m) => m.id === tid) : undefined);

  /** This page's URL with some params changed (undefined/[] removes them). */
  const href = (patch: Partial<Record<"status" | "q" | "d", string | undefined> & { kind: string[]; teammate: string[] }>) => {
    const cur = { status: f.status, q: f.q, d: peekId, kind: f.kinds, teammate: f.teammates, ...patch };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(cur)) {
      if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
      else if (v) q.set(k, v);
    }
    const s = q.toString();
    return `/b/${id}/deliverables${s ? `?${s}` : ""}`;
  };

  const views: LineTab[] = VIEWS.map((v) => ({
    href: href({ status: v.status, d: undefined }),
    label: t(lang, v.key),
    active: (f.status ?? undefined) === v.status,
    count: v.status ? data.counts.get(v.status) ?? 0 : data.total,
  }));
  const filtered = Boolean(f.status || f.kinds.length || f.teammates.length || f.q);
  const peek = data.peek;
  const peekMate = peek ? mate(peek.teammateId) : undefined;

  return (
    <SidePeekLayout
      peek={
        <DeliverablePeek open={!!peek} title={peek ? kindLabel(peek.kind) : undefined} openHref={peek ? `/b/${id}/studio/docs?doc=${peek.id}` : undefined}>
          {peek && (
            <DeliverableDetail
              d={peek}
              teammate={peekMate}
              revisingBy={data.revising.has(peek.id) ? (data.revising.get(peek.id) ?? t(lang, "work.aTeammate")) : null}
              lang={lang}
            />
          )}
        </DeliverablePeek>
      }
    >
      <PageBody width="wide">
        <LiveRefresh
          businessId={id}
          types={["deliverable_saved", "deliverable_ready", "message_drafted", "deliverable_status", "deliverable_revised", "task_done"]}
        />
        <PageHeader title={t(lang, "work.title")} description={t(lang, "work.description")} />

        <div className="flex flex-col-reverse gap-2 border-b border-border sm:flex-row sm:items-end sm:gap-4">
          <LineTabs items={views} label={t(lang, "work.title")} className="min-w-0 flex-1 border-b-0" />
          <div className="flex items-center gap-1 sm:pb-0.5">
            <WorkFilters kinds={data.kinds} mates={data.mates.map((m) => ({ id: m.id, name: m.name, color: m.color }))} />
            <WorkSearch />
          </div>
        </div>

        {(f.kinds.length > 0 || f.teammates.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            {f.kinds.map((k) => (
              <FilterPill key={`k-${k}`} href={href({ kind: f.kinds.filter((x) => x !== k), d: undefined })} label={t(lang, "work.filter.kind")}>
                {kindLabel(k)}
              </FilterPill>
            ))}
            {f.teammates.map((tid) => (
              <FilterPill key={`t-${tid}`} href={href({ teammate: f.teammates.filter((x) => x !== tid), d: undefined })} label={t(lang, "work.filter.teammate")}>
                {mate(tid)?.name ?? tid}
              </FilterPill>
            ))}
          </div>
        )}

        <DataTable<Deliverable>
          className="mt-1"
          rows={data.rows}
          getRowId={(d) => d.id}
          rowHref={(d) => href({ d: d.id })}
          selectedId={peek?.id}
          minWidth={820}
          label={t(lang, "work.title")}
          empty={
            filtered ? (
              <EmptyState
                icon={<FolderCheck />}
                title={t(lang, "work.noMatch.title")}
                body={t(lang, "work.empty")}
                action={
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/b/${id}/deliverables`} scroll={false}>
                      {t(lang, "work.filter.clear")}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={<FolderCheck />} title={t(lang, "work.empty.title")} body={t(lang, "work.empty.body")} />
            )
          }
          columns={[
            {
              key: "title",
              header: t(lang, "work.col.title"),
              icon: <Type />,
              title: (d) => d.title,
              cell: (d) => (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{d.title}</span>
                  {d.attachments.length > 0 && (
                    <span
                      className="inline-flex shrink-0 items-center gap-0.5 text-xs font-normal text-tertiary"
                      title={tn(lang, "work.files", d.attachments.length)}
                    >
                      <ImageIcon className="size-3.5" aria-hidden />
                      {d.attachments.length}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "kind",
              header: t(lang, "work.filter.kind"),
              icon: <Tag />,
              width: 120,
              cell: (d) => (
                <Badge tone="gray">
                  {kindLabel(d.kind)}
                </Badge>
              ),
            },
            {
              key: "status",
              header: t(lang, "work.filter.status"),
              icon: <CircleDot />,
              width: 120,
              cell: (d) => <StatusBadge status={d.status} lang={lang} />,
            },
            {
              key: "teammate",
              header: t(lang, "work.filter.teammate"),
              icon: <User />,
              width: 128,
              title: (d) => mate(d.teammateId)?.name,
              cell: (d) => {
                const m = mate(d.teammateId);
                return m ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar seed={m.id} name={m.name} color={m.color} size={20} />
                    <span className="truncate">{m.name}</span>
                  </span>
                ) : (
                  <span className="text-tertiary">—</span>
                );
              },
            },
            {
              key: "channel",
              header: t(lang, "work.col.channel"),
              icon: <Radio />,
              width: 96,
              title: (d) => d.channel ?? undefined,
              cell: (d) => (d.channel ? <span>{d.channel}</span> : <span className="text-tertiary">—</span>),
            },
            {
              key: "updated",
              header: t(lang, "work.col.updated"),
              icon: <Clock />,
              width: 96,
              title: (d) => fullTime(updatedAt(d), lang),
              cell: (d) => <span className="text-xs text-tertiary">{relativeTime(updatedAt(d), lang)}</span>,
            },
          ]}
        />
      </PageBody>
    </SidePeekLayout>
  );
}

function StatusBadge({ status, lang }: { status: string; lang: UiLang }) {
  const s = statusTone("deliverable", status);
  return <Badge tone={s.tone}>{t(lang, s.label)}</Badge>;
}

function FilterPill({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex h-6 items-center gap-1 rounded-full bg-primary-soft pr-1.5 pl-2.5 text-xs font-medium text-primary transition-colors duration-100 hover:bg-primary/15"
    >
      <span className="font-normal opacity-80">{label}:</span>
      <span>{children}</span>
      <X className="size-3" aria-hidden />
    </Link>
  );
}

/** The peek body: one piece of work with its text, files, Copy / Mark posted and feedback. */
function DeliverableDetail({
  d,
  teammate,
  revisingBy,
  lang,
}: {
  d: Deliverable;
  teammate?: { id: string; name: string; color: string; title: string };
  revisingBy: string | null;
  lang: UiLang;
}) {
  const isMessage = d.kind === "outbound_message";
  const canMark = d.status === "ready_to_post" || d.status === "approved";
  return (
    <article className="space-y-5">
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="gray">
            {kindLabel(d.kind)}
          </Badge>
          <StatusBadge status={d.status} lang={lang} />
        </div>
        <h2 className="text-xl leading-7 font-semibold tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{d.title}</h2>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-tertiary">
          {teammate && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Avatar seed={teammate.id} name={teammate.name} color={teammate.color} size={16} />
              {teammate.name}
            </span>
          )}
          {d.channel && <span>· {d.channel}</span>}
          <span title={fullTime(d.createdAt, lang)}>· {relativeTime(updatedAt(d), lang)}</span>
          {d.versions.length > 0 && <span>· {t(lang, "work.version", { n: d.versions.length + 1 })}</span>}
        </div>
        {revisingBy && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            {t(lang, "work.revising", { name: revisingBy })}
          </p>
        )}
      </header>

      {d.status === "ready_to_post" && (
        <p className="rounded-md bg-muted px-3 py-2 text-[13px] leading-[18px] text-muted-foreground">
          {t(lang, isMessage ? "work.readySend" : "work.readyPost", {
            on: d.channel ? t(lang, "work.readyOn", { channel: d.channel }) : "",
            files: d.attachments.length ? t(lang, "work.readyFiles") : "",
          })}
        </p>
      )}

      {d.attachments.length > 0 && <ImageStrip businessId={d.businessId} images={d.attachments} size={96} />}

      <Prose className="text-[15px] leading-6">{d.content}</Prose>

      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={d.content} />
        {canMark && <MarkPostedButton businessId={d.businessId} deliverableId={d.id} title={d.title} isMessage={isMessage} />}
      </div>

      <section className="space-y-2 border-t border-border pt-5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t(lang, "work.fb.title")}</h3>
          <p className="text-xs text-tertiary">{t(lang, "work.fb.hint")}</p>
        </div>
        <FeedbackForm key={d.id} businessId={d.businessId} deliverableId={d.id} canRevise={d.status !== "published"} />
      </section>
    </article>
  );
}
