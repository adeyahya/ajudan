import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { LiveRefresh } from "@/components/live";
import { Badge, Button, Card, PageHeader, PageSkeleton } from "@/components/kit";
import { formatUsd } from "@/lib/budget";
import { getBusiness } from "@/lib/data";
import { dateLocale, t, tn, uiLang, type MessageKey, type UiLang } from "@/lib/i18n";
import { formatAge, getFailures, getLastBackup, getQueue, getSpendRollup, getWorkerHealth } from "@/lib/health";
import { HEARTBEAT_MS } from "@/lib/worker-heartbeat";
import { retryTaskAction } from "../teammates/[tid]/actions";
import { PollRefresh } from "./poll";

type Params = { params: Promise<{ id: string }> };

export default function HealthPage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

const whenIn = (lang: UiLang) => (d: Date) => d.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

const JOB_KINDS = ["run_task", "onboarding_turn", "onboarding_finalize", "design_team", "consolidate_memory"];
const jobLabel = (lang: UiLang, kind: string) => (JOB_KINDS.includes(kind) ? t(lang, `health.job.${kind}` as MessageKey) : kind);

async function Content({ params }: Params) {
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

  return (
    <div>
      <LiveRefresh businessId={id} />
      <PollRefresh everyMs={HEARTBEAT_MS + 5000} />
      <PageHeader title={t(lang, "health.title")} subtitle={t(lang, "health.subtitle", { time: when(now) })} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">{t(lang, "health.worker")}</h2>
          {!worker || worker.status === "stopped" ? (
            <div className="grid gap-1">
              <Badge tone="red" className="w-fit">
                {t(lang, "health.stopped")}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {t(lang, "health.stoppedBody")}
                {worker?.heartbeat && t(lang, "health.lastSeen", { time: when(new Date(worker.heartbeat.at)), pid: worker.heartbeat.pid })}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Badge tone={worker.status === "running" ? "green" : "amber"} className="w-fit">
                {t(lang, worker.status === "running" ? "health.running" : "health.notResponding")}
              </Badge>
              {worker.status === "stale" && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t(lang, "health.stale", { pid: worker.heartbeat!.pid, age: age(worker.ageMs ?? 0) })}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Stat label={t(lang, "health.lastHeartbeat")} value={worker.ageMs === null ? "—" : t(lang, "health.ago", { age: age(worker.ageMs) })} />
                <Stat label={t(lang, "health.upSince")} value={when(new Date(worker.heartbeat!.startedAt))} />
                <Stat label={t(lang, "health.process")} value={`pid ${worker.heartbeat!.pid}`} />
                <Stat
                  label={t(lang, "health.teamLane")}
                  value={t(lang, "health.busy", { running: worker.heartbeat!.running.team, total: worker.heartbeat!.concurrency.team })}
                />
                <Stat
                  label={t(lang, "health.ownerLane")}
                  value={t(lang, "health.busy", { running: worker.heartbeat!.running.owner, total: worker.heartbeat!.concurrency.owner })}
                />
              </dl>
            </div>
          )}
        </Card>

        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">{t(lang, "health.backup")}</h2>
          {backup ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <Stat label={t(lang, "health.lastBackup")} value={when(backup.at)} />
              <Stat label={t(lang, "health.file")} value={`backups/${backup.file} (${(backup.bytes / 1024 / 1024).toFixed(1)} MB)`} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t(lang, "health.noBackup")}</p>
          )}
          <p className="text-xs text-muted-foreground">{t(lang, "health.backupKeep")}</p>
        </Card>

        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">
            {t(lang, "health.queue")}{" "}
            <span className="font-normal text-muted-foreground">{t(lang, "health.queueCounts", { running: running.length, queued: queued.length })}</span>
          </h2>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "health.queueEmpty")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {queue.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <Badge tone={j.status === "running" ? "blue" : "neutral"}>
                    {j.status === "running" || j.status === "queued" ? t(lang, `health.jobStatus.${j.status}`) : j.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{t(lang, "health.lane", { lane: j.lane })}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {jobLabel(lang, j.kind)}
                    {j.task && (
                      <>
                        {": "}
                        <Link href={`/b/${id}/teammates/${j.task.teammateId}`} className="hover:underline">
                          {j.task.teammate}
                        </Link>{" "}
                        — {j.task.title}
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(lang, j.status === "running" ? "health.for" : "health.waiting", { age: age(j.sinceMs) })}
                    {j.attempts > 1 ? t(lang, "health.try", { n: j.attempts }) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {spend.cap > 0 && spend.today >= spend.cap && queued.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">{t(lang, "health.budgetSpent")}</p>
          )}
        </Card>

        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">{t(lang, "health.spend")}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{t(lang, "health.today")}</dt>
              <dd className={`font-medium ${spend.cap > 0 && spend.today >= spend.cap ? "text-red-600 dark:text-red-400" : ""}`}>
                {formatUsd(spend.today)} <span className="font-normal text-muted-foreground">{t(lang, "health.of", { cap: formatUsd(spend.cap) })}</span>
              </dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{t(lang, "health.week")}</dt>
              <dd className="font-medium">{formatUsd(spend.week)}</dd>
            </div>
          </dl>
          {teammates.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">{t(lang, "health.teammate")}</th>
                  <th className="py-1 text-right font-medium">{t(lang, "health.today")}</th>
                  <th className="py-1 text-right font-medium">{t(lang, "health.week")}</th>
                  <th className="py-1 text-right font-medium">{t(lang, "health.tasksWeek")}</th>
                </tr>
              </thead>
              <tbody>
                {teammates.map((m) => (
                  <tr key={m.teammateId} className="border-t border-border">
                    <td className="py-1">
                      <Link href={`/b/${id}/teammates/${m.teammateId}`} className="hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className="py-1 text-right">{formatUsd(m.today)}</td>
                    <td className="py-1 text-right">{formatUsd(weekByTeammate.get(m.teammateId)?.total ?? 0)}</td>
                    <td className="py-1 text-right">{m.tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">
            {t(lang, "health.spendNoteBefore")}{" "}
            <Link href={`/b/${id}/profile`} className="underline">
              {t(lang, "health.spendNoteLink")}
            </Link>
            .
          </p>
        </Card>

        <Card className="p-5 grid gap-3 content-start lg:col-span-2">
          <h2 className="font-medium">{t(lang, "health.failures")}</h2>
          {failures.tasks.length === 0 && failures.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "health.noFailures")}</p>
          ) : (
            <>
              {failures.tasks.length > 0 && (
                <ul className="divide-y divide-border text-sm">
                  {failures.tasks.map((f) => (
                    <li key={f.id} className="grid gap-1 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link href={`/b/${id}/teammates/${f.teammateId}`} className="font-medium hover:underline">
                          {f.teammate}
                        </Link>
                        <span className="min-w-0 flex-1 truncate">{f.title}</span>
                        {f.finishedAt && <span className="text-xs text-muted-foreground">{when(f.finishedAt)}</span>}
                        <form action={retryTaskAction}>
                          <input type="hidden" name="businessId" value={id} />
                          <input type="hidden" name="taskId" value={f.id} />
                          <Button type="submit" variant="secondary" size="sm">
                            {t(lang, "health.retry")}
                          </Button>
                        </form>
                      </div>
                      {f.result && <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{clip(f.result)}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {failures.jobs.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    {tn(lang, "health.failedJobs", failures.jobs.length)}
                  </summary>
                  <ul className="mt-2 divide-y divide-border">
                    {failures.jobs.map((j) => (
                      <li key={j.id} className="grid gap-1 py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium">
                            #{j.id} {jobLabel(lang, j.kind)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {tn(lang, "health.tries", j.attempts)}
                            {j.finishedAt ? ` · ${when(j.finishedAt)}` : ""}
                          </span>
                        </div>
                        {j.error && <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{clip(j.error, 600)}</pre>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
