import { AlertTriangle, CircleDot, Clock, Hash, Layers, ListOrdered, RotateCcw, User, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { LiveRefresh } from "@/components/live";
import { DataTable } from "@/components/data-table";
import { Badge, EmptyState, PageBody, PageHeader, PropertyList, Section, Skeleton, StatusDot, TableSkeleton, cn } from "@/components/kit";
import { formatUsd } from "@/lib/budget";
import { getBusiness } from "@/lib/data";
import { dateLocale, t, tn, uiLang, type MessageKey, type UiLang } from "@/lib/i18n";
import { formatAge, getFailures, getLastBackup, getQueue, getSpendRollup, getWorkerHealth } from "@/lib/health";
import { statusTone } from "@/lib/status-tones";
import { HEARTBEAT_MS } from "@/lib/worker-heartbeat";
import { retryTaskAction } from "../teammates/[tid]/actions";
import { ActionForm, SubmitButton } from "../team/action-form";
import { ErrorDetail } from "./error-detail";
import { PollRefresh } from "./poll";

/**
 * Jobs & health: four stat tiles (worker, queue, spend, backup), then the queue, recent
 * failures and spend per teammate as tables. Live (SSE) plus a poll, since a dead worker
 * writes no events.
 */
export default function HealthPage(props: PageProps<"/b/[id]/health">) {
  return (
    <Suspense
      fallback={
        <PageBody width="wide">
          <Skeleton className="h-[34px] w-56 rounded-md" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[92px] rounded-lg" />
            ))}
          </div>
          <TableSkeleton rows={4} cols={5} className="mt-10" />
        </PageBody>
      }
    >
      <Content params={props.params} />
    </Suspense>
  );
}

const whenIn = (lang: UiLang) => (d: Date) => d.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

const JOB_KINDS = ["run_task", "onboarding_turn", "onboarding_finalize", "design_team", "consolidate_memory"];
const jobLabel = (lang: UiLang, kind: string) => (JOB_KINDS.includes(kind) ? t(lang, `health.job.${kind}` as MessageKey) : kind);

function Tile({ label, icon, children, note, tone }: { label: string; icon: ReactNode; children: ReactNode; note?: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-4">
      <div className="flex items-center gap-1.5 text-xs text-tertiary [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 truncate text-xl leading-7 font-semibold tabular-nums",
          tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {children}
      </div>
      {note && <div className="mt-0.5 truncate text-[13px] leading-[18px] text-muted-foreground">{note}</div>}
    </div>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const lang = uiLang(biz.language);
  const when = whenIn(lang);
  const age = (ms: number) => formatAge(ms, lang);
  const now = new Date();
  const [worker, queue, failures, spend, backup] = await Promise.all([
    getWorkerHealth(),
    getQueue(id, now.getTime()),
    getFailures(id),
    getSpendRollup(id, now),
    getLastBackup(),
  ]);
  const queued = queue.filter((j) => j.status === "queued");
  const running = queue.filter((j) => j.status === "running");
  const weekByTeammate = new Map(spend.byTeammateWeek.map((r) => [r.teammateId, r]));
  const teammates = spend.byTeammateWeek.map((w) => ({
    ...w,
    today: spend.byTeammateToday.find((r) => r.teammateId === w.teammateId)?.total ?? 0,
  }));
  const overBudget = spend.cap > 0 && spend.today >= spend.cap;
  const stopped = !worker || worker.status === "stopped";
  const hb = !stopped ? worker.heartbeat : null;
  const mateLink = (teammateId: string, name: string) => (
    <Link href={`/b/${id}/teammates/${teammateId}`} className="hover:underline">
      {name}
    </Link>
  );

  return (
    <PageBody width="wide">
      <LiveRefresh businessId={id} />
      <PollRefresh everyMs={HEARTBEAT_MS + 5000} />
      <PageHeader title={t(lang, "health.title")} description={t(lang, "health.subtitle", { time: when(now) })} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t(lang, "health.worker")}
          icon={<CircleDot />}
          tone={stopped ? "danger" : worker.status === "stale" ? "warning" : undefined}
          note={hb && worker!.ageMs !== null ? t(lang, "health.heartbeatAgo", { age: age(worker!.ageMs) }) : t(lang, "health.noHeartbeat")}
        >
          <StatusDot state={stopped ? "error" : worker.status === "running" ? "working" : "waiting"} />
          {t(lang, stopped ? "health.stopped" : worker.status === "running" ? "health.running" : "health.notResponding")}
        </Tile>
        <Tile label={t(lang, "health.queue")} icon={<ListOrdered />} note={t(lang, "health.queuedCount", { queued: queued.length })}>
          {t(lang, "health.runningCount", { running: running.length })}
        </Tile>
        <Tile
          label={t(lang, "health.spendToday")}
          icon={<Wallet />}
          tone={overBudget ? "danger" : undefined}
          note={[spend.cap > 0 && t(lang, "health.of", { cap: formatUsd(spend.cap) }), t(lang, "health.weekAmount", { amount: formatUsd(spend.week) })].filter(Boolean).join(" · ")}
        >
          {formatUsd(spend.today)}
        </Tile>
        <Tile
          label={t(lang, "health.lastBackup")}
          icon={<Clock />}
          note={backup ? `${(backup.bytes / 1024 / 1024).toFixed(1)} MB · ${t(lang, "health.keep7")}` : t(lang, "health.noBackupShort")}
        >
          {backup ? backup.at.toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" }) : "—"}
        </Tile>
      </div>

      {stopped ? (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-[13px] leading-5 text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            {t(lang, "health.stoppedBody")}
            {worker?.heartbeat && t(lang, "health.lastSeen", { time: when(new Date(worker.heartbeat.at)), pid: worker.heartbeat.pid })}
          </p>
        </div>
      ) : (
        worker.status === "stale" && (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-[13px] leading-5 text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>{t(lang, "health.stale", { pid: worker.heartbeat!.pid, age: age(worker.ageMs ?? 0) })}</p>
          </div>
        )
      )}

      <Section title={t(lang, "health.queue")} className="mt-10" description={queue.length ? t(lang, "health.queueCountsLong", { running: running.length, queued: queued.length }) : undefined}>
        {overBudget && queued.length > 0 && <p className="mb-3 text-[13px] text-destructive">{t(lang, "health.budgetSpent")}</p>}
        <DataTable
          label={t(lang, "health.queue")}
          rows={queue}
          getRowId={(j) => String(j.id)}
          minWidth={720}
          empty={<EmptyState compact icon={<ListOrdered />} title={t(lang, "health.queueEmpty")} />}
          columns={[
            {
              key: "job",
              header: t(lang, "health.col.job"),
              icon: <Hash />,
              title: (j) => (j.task ? j.task.title : jobLabel(lang, j.kind)),
              cell: (j) => (
                <span className="block truncate">
                  {jobLabel(lang, j.kind)}
                  {j.task && <span className="font-normal text-muted-foreground"> · {j.task.title}</span>}
                </span>
              ),
            },
            {
              key: "status",
              header: t(lang, "health.col.status"),
              icon: <CircleDot />,
              width: 110,
              cell: (j) => <Badge tone={statusTone("task", j.status).tone}>{t(lang, statusTone("task", j.status).label)}</Badge>,
            },
            { key: "lane", header: t(lang, "health.col.lane"), icon: <Layers />, width: 100, cell: (j) => t(lang, `health.laneName.${j.lane}` as MessageKey) },
            { key: "teammate", header: t(lang, "health.teammate"), icon: <User />, width: 140, cell: (j) => (j.task ? mateLink(j.task.teammateId, j.task.teammate) : <span className="text-tertiary">—</span>) },
            {
              key: "since",
              header: t(lang, "health.col.since"),
              icon: <Clock />,
              width: 130,
              cell: (j) => t(lang, j.status === "running" ? "health.for" : "health.waiting", { age: age(j.sinceMs) }),
            },
            { key: "attempts", header: t(lang, "health.col.attempts"), icon: <RotateCcw />, width: 90, align: "right", cell: (j) => j.attempts },
          ]}
        />
      </Section>

      {hb && (
        <Section title={t(lang, "health.worker")}>
          <PropertyList
            items={[
              { label: t(lang, "health.lastHeartbeat"), value: worker!.ageMs === null ? "—" : t(lang, "health.ago", { age: age(worker!.ageMs) }) },
              { label: t(lang, "health.upSince"), value: when(new Date(hb.startedAt)) },
              { label: t(lang, "health.process"), value: <span className="tabular-nums">pid {hb.pid}</span> },
              { label: t(lang, "health.teamLane"), value: t(lang, "health.busy", { running: hb.running.team, total: hb.concurrency.team }) },
              { label: t(lang, "health.ownerLane"), value: t(lang, "health.busy", { running: hb.running.owner, total: hb.concurrency.owner }) },
            ]}
          />
        </Section>
      )}

      <Section title={t(lang, "health.failures")}>
        {failures.tasks.length === 0 && failures.jobs.length === 0 ? (
          <EmptyState compact icon={<AlertTriangle />} title={t(lang, "health.noFailures")} />
        ) : (
          <>
            {failures.tasks.length > 0 && (
              <ul className="border-t border-border">
                {failures.tasks.map((f) => (
                  <li key={f.id} className="border-b border-border/70 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium text-foreground">{mateLink(f.teammateId, f.teammate)}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={f.title}>
                        {f.title}
                      </span>
                      {f.finishedAt && <span className="text-xs text-tertiary">{when(f.finishedAt)}</span>}
                      <ActionForm action={retryTaskAction} success={t(lang, "health.toast.retried")}>
                        <input type="hidden" name="businessId" value={id} />
                        <input type="hidden" name="taskId" value={f.id} />
                        <SubmitButton variant="secondary" size="sm">
                          <RotateCcw />
                          {t(lang, "health.retry")}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                    {f.result && <ErrorDetail label={t(lang, "health.showError")}>{clip(f.result)}</ErrorDetail>}
                  </li>
                ))}
              </ul>
            )}
            {failures.jobs.length > 0 && (
              <ErrorDetail label={tn(lang, "health.failedJobs", failures.jobs.length)} plain className="mt-3">
                <ul className="divide-y divide-border/70">
                  {failures.jobs.map((j) => (
                    <li key={j.id} className="grid gap-1 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                        <span className="font-medium text-foreground">
                          #{j.id} {jobLabel(lang, j.kind)}
                        </span>
                        <span className="text-xs text-tertiary">
                          {tn(lang, "health.tries", j.attempts)}
                          {j.finishedAt ? ` · ${when(j.finishedAt)}` : ""}
                        </span>
                      </div>
                      {j.error && <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{clip(j.error, 600)}</pre>}
                    </li>
                  ))}
                </ul>
              </ErrorDetail>
            )}
          </>
        )}
      </Section>

      <Section title={t(lang, "health.spendByTeammate")} description={t(lang, "health.spendNoteShort")}>
        <DataTable
          label={t(lang, "health.spendByTeammate")}
          rows={teammates}
          getRowId={(m) => m.teammateId}
          minWidth={480}
          empty={<EmptyState compact icon={<Wallet />} title={t(lang, "health.noSpend")} />}
          columns={[
            { key: "name", header: t(lang, "health.teammate"), icon: <User />, cell: (m) => mateLink(m.teammateId, m.name) },
            { key: "today", header: t(lang, "health.today"), width: 120, align: "right", cell: (m) => formatUsd(m.today) },
            { key: "week", header: t(lang, "health.week"), width: 120, align: "right", cell: (m) => formatUsd(weekByTeammate.get(m.teammateId)?.total ?? 0) },
            { key: "tasks", header: t(lang, "health.tasksWeek"), width: 120, align: "right", cell: (m) => m.tasks },
          ]}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {t(lang, "health.spendNoteBefore")}{" "}
          <Link href={`/b/${id}/profile?tab=budget`} className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
            {t(lang, "health.spendNoteLink")}
          </Link>
          .
        </p>
      </Section>
    </PageBody>
  );
}
