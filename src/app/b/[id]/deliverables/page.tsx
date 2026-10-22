import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, desc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { DeliverableStatus } from "@/db/schema";
import { LiveRefresh } from "@/components/live";
import { PageHeader, PageSkeleton, cn } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { t, uiLang } from "@/lib/i18n";
import { DeliverableCard, deliverableLabel, kindLabel } from "./deliverable-card";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUSES: DeliverableStatus[] = ["draft", "ready_to_post", "approved", "published", "rejected"];

export default function DeliverablesPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

type Filters = { status?: string; kind?: string; teammate?: string };

async function loadDeliverables(businessId: string, f: Filters) {
  await connection();
  const where: SQL[] = [eq(schema.deliverables.businessId, businessId)];
  if (f.status && STATUSES.includes(f.status as DeliverableStatus))
    where.push(eq(schema.deliverables.status, f.status as DeliverableStatus));
  if (f.kind) where.push(eq(schema.deliverables.kind, f.kind));
  if (f.teammate) where.push(eq(schema.deliverables.teammateId, f.teammate));
  const rows = db
    .select()
    .from(schema.deliverables)
    .where(and(...where))
    .orderBy(desc(schema.deliverables.createdAt))
    .limit(300)
    .all();
  const kinds = db
    .selectDistinct({ kind: schema.deliverables.kind })
    .from(schema.deliverables)
    .where(eq(schema.deliverables.businessId, businessId))
    .all()
    .map((k) => k.kind)
    .sort();
  const mates = db.select().from(schema.teammates).where(eq(schema.teammates.businessId, businessId)).all();
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
  return { rows, kinds, mates, revising };
}

async function Content({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const f: Filters = { status: one(sp.status), kind: one(sp.kind), teammate: one(sp.teammate) };
  const [biz, data] = await Promise.all([getBusiness(id), loadDeliverables(id, f)]);
  if (!biz) notFound();
  const lang = uiLang(biz.language);

  const href = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return `/b/${id}/deliverables${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <LiveRefresh
        businessId={id}
        types={["deliverable_saved", "deliverable_ready", "message_drafted", "deliverable_status", "deliverable_revised", "task_done"]}
      />
      <PageHeader
        title={t(lang, "work.title")}
        subtitle={t(lang, "work.subtitle")}
      />

      <div className="space-y-2">
        <FilterRow label={t(lang, "work.filter.status")}>
          <Chip href={href({ status: undefined })} active={!f.status}>
            All
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} href={href({ status: s })} active={f.status === s}>
              {deliverableLabel(s, lang)}
            </Chip>
          ))}
        </FilterRow>
        {data.kinds.length > 0 && (
          <FilterRow label={t(lang, "work.filter.kind")}>
            <Chip href={href({ kind: undefined })} active={!f.kind}>
              {t(lang, "work.all")}
            </Chip>
            {data.kinds.map((k) => (
              <Chip key={k} href={href({ kind: k })} active={f.kind === k}>
                {kindLabel(k)}
              </Chip>
            ))}
          </FilterRow>
        )}
        {data.mates.length > 0 && (
          <FilterRow label={t(lang, "work.filter.teammate")}>
            <Chip href={href({ teammate: undefined })} active={!f.teammate}>
              {t(lang, "work.all")}
            </Chip>
            {data.mates.map((m) => (
              <Chip key={m.id} href={href({ teammate: m.id })} active={f.teammate === m.id}>
                {m.name}
              </Chip>
            ))}
          </FilterRow>
        )}
      </div>

      <div className="space-y-2">
        {data.rows.length === 0 && <p className="text-sm text-muted-foreground">{t(lang, "work.empty")}</p>}
        {data.rows.map((d) => {
          const m = data.mates.find((x) => x.id === d.teammateId);
          return (
            <DeliverableCard
              key={d.id}
              d={d}
              teammate={m ? { id: m.id, name: m.name, color: m.color } : null}
              revisingBy={data.revising.has(d.id) ? (data.revising.get(d.id) ?? t(lang, "work.aTeammate")) : null}
              lang={lang}
            />
          );
        })}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs capitalize",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
