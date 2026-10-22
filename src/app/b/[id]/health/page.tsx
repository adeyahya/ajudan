import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { LiveRefresh } from "@/components/live";
import { Badge, Button, Card, PageHeader, PageSkeleton } from "@/components/kit";
import { formatUsd } from "@/lib/budget";
import { getBusiness } from "@/lib/data";
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

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

const JOB_LABEL: Record<string, string> = {
  run_task: "Task",
  onboarding_turn: "Interview reply",
  onboarding_finalize: "Finish interview",
  design_team: "Team design",
  consolidate_memory: "Memory tidy-up",
};

async function Content({ params }: Params) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
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
    today: spend.byTeammateToday.find((t) => t.teammateId === w.teammateId)?.total ?? 0,
  }));

  return (
    <div>
      <LiveRefresh businessId={id} />
      <PollRefresh everyMs={HEARTBEAT_MS + 5000} />
      <PageHeader title="Jobs & health" subtitle={`Is the worker alive, what it's doing, what went wrong, and what the team spent. Updates live; checked ${when(now)}.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">Worker</h2>
          {!worker || worker.status === "stopped" ? (
            <div className="grid gap-1">
              <Badge tone="red" className="w-fit">
                Stopped
              </Badge>
              <p className="text-sm text-muted-foreground">
                No worker is running on this business folder, so nothing runs: queued work waits. Start it with `pnpm dev` (or reopen the business in
                the Ajudan app).
                {worker?.heartbeat && ` Last seen ${when(new Date(worker.heartbeat.at))} (pid ${worker.heartbeat.pid}).`}
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Badge tone={worker.status === "running" ? "green" : "amber"} className="w-fit">
                {worker.status === "running" ? "Running" : "Not responding"}
              </Badge>
              {worker.status === "stale" && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  The worker process (pid {worker.heartbeat!.pid}) is alive but hasn&apos;t checked in for {formatAge(worker.ageMs ?? 0)}. It may be stuck;
                  restarting it is safe (running jobs go back to the queue).
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Stat label="Last heartbeat" value={worker.ageMs === null ? "—" : `${formatAge(worker.ageMs)} ago`} />
                <Stat label="Up since" value={when(new Date(worker.heartbeat!.startedAt))} />
                <Stat label="Process" value={`pid ${worker.heartbeat!.pid}`} />
                <Stat label="Team lane" value={`${worker.heartbeat!.running.team} of ${worker.heartbeat!.concurrency.team} busy`} />
                <Stat label="Owner lane" value={`${worker.heartbeat!.running.owner} of ${worker.heartbeat!.concurrency.owner} busy`} />
              </dl>
            </div>
          )}
        </Card>

        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">Daily backup</h2>
          {backup ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <Stat label="Last backup" value={when(backup.at)} />
              <Stat label="File" value={`backups/${backup.file} (${(backup.bytes / 1024 / 1024).toFixed(1)} MB)`} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No daily backup yet. The worker makes one each day it runs, in the folder&apos;s backups/.</p>
          )}
          <p className="text-xs text-muted-foreground">The worker keeps the last 7 daily copies; migration backups are kept separately.</p>
        </Card>

        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">
            Queue <span className="font-normal text-muted-foreground">· {running.length} running, {queued.length} queued</span>
          </h2>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing queued. The team is idle.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {queue.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <Badge tone={j.status === "running" ? "blue" : "neutral"}>{j.status}</Badge>
                  <span className="text-xs text-muted-foreground">{j.lane} lane</span>
                  <span className="min-w-0 flex-1 truncate">
                    {JOB_LABEL[j.kind] ?? j.kind}
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
                    {j.status === "running" ? "for" : "waiting"} {formatAge(j.sinceMs)}
                    {j.attempts > 1 ? ` · try ${j.attempts}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {spend.cap > 0 && spend.today >= spend.cap && queued.length > 0 && (
            <p className="text-xs text-red-600 dark:text-red-400">Today&apos;s budget is spent: queued tasks wait until tomorrow or until you raise it.</p>
          )}
        </Card>

        <Card className="p-5 grid gap-3 content-start">
          <h2 className="font-medium">Spend</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Today</dt>
              <dd className={`font-medium ${spend.cap > 0 && spend.today >= spend.cap ? "text-red-600 dark:text-red-400" : ""}`}>
                {formatUsd(spend.today)} <span className="font-normal text-muted-foreground">of {formatUsd(spend.cap)}</span>
              </dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">This week</dt>
              <dd className="font-medium">{formatUsd(spend.week)}</dd>
            </div>
          </dl>
          {teammates.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Teammate</th>
                  <th className="py-1 text-right font-medium">Today</th>
                  <th className="py-1 text-right font-medium">This week</th>
                  <th className="py-1 text-right font-medium">Tasks (week)</th>
                </tr>
              </thead>
              <tbody>
                {teammates.map((t) => (
                  <tr key={t.teammateId} className="border-t border-border">
                    <td className="py-1">
                      <Link href={`/b/${id}/teammates/${t.teammateId}`} className="hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="py-1 text-right">{formatUsd(t.today)}</td>
                    <td className="py-1 text-right">{formatUsd(weekByTeammate.get(t.teammateId)?.total ?? 0)}</td>
                    <td className="py-1 text-right">{t.tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">
            From finished tasks; a run in progress isn&apos;t counted yet. Change the daily budget on the{" "}
            <Link href={`/b/${id}/profile`} className="underline">
              Business page
            </Link>
            .
          </p>
        </Card>

        <Card className="p-5 grid gap-3 content-start lg:col-span-2">
          <h2 className="font-medium">Recent failures</h2>
          {failures.tasks.length === 0 && failures.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed tasks or jobs.</p>
          ) : (
            <>
              {failures.tasks.length > 0 && (
                <ul className="divide-y divide-border text-sm">
                  {failures.tasks.map((t) => (
                    <li key={t.id} className="grid gap-1 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link href={`/b/${id}/teammates/${t.teammateId}`} className="font-medium hover:underline">
                          {t.teammate}
                        </Link>
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                        {t.finishedAt && <span className="text-xs text-muted-foreground">{when(t.finishedAt)}</span>}
                        <form action={retryTaskAction}>
                          <input type="hidden" name="businessId" value={id} />
                          <input type="hidden" name="taskId" value={t.id} />
                          <Button type="submit" variant="secondary" size="sm">
                            Retry
                          </Button>
                        </form>
                      </div>
                      {t.result && <p className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{clip(t.result)}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {failures.jobs.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    {failures.jobs.length} failed job{failures.jobs.length === 1 ? "" : "s"} (worker log detail)
                  </summary>
                  <ul className="mt-2 divide-y divide-border">
                    {failures.jobs.map((j) => (
                      <li key={j.id} className="grid gap-1 py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium">
                            #{j.id} {JOB_LABEL[j.kind] ?? j.kind}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {j.attempts} {j.attempts === 1 ? "try" : "tries"}
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
