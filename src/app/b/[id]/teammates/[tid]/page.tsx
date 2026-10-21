import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { Task, TaskStatus, TeammateState } from "@/db/schema";
import { Chat, type ChatMessage } from "@/components/chat";
import { LiveRefresh } from "@/components/live";
import { Avatar, Badge, Button, Card, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { describeCron } from "@/lib/onboarding/schedule";
import { runScheduledNow, sendTaskMessage } from "./actions";

type Params = { params: Promise<{ id: string; tid: string }> };

export default function TeammatePage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

const STATE_TONE: Record<TeammateState, "neutral" | "green" | "amber" | "red"> = {
  idle: "neutral",
  working: "green",
  waiting: "amber",
  error: "red",
};

const TASK_TONE: Record<TaskStatus, "neutral" | "green" | "amber" | "red" | "blue"> = {
  queued: "neutral",
  running: "blue",
  waiting_approval: "amber",
  done: "green",
  failed: "red",
  cancelled: "neutral",
};

async function loadTeammate(businessId: string, teammateId: string) {
  await connection();
  const teammate = db
    .select()
    .from(schema.teammates)
    .where(and(eq(schema.teammates.id, teammateId), eq(schema.teammates.businessId, businessId)))
    .get();
  if (!teammate) return undefined;
  // Latest 30 tasks, shown oldest first as a conversation.
  const tasks = db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.teammateId, teammateId))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(30)
    .all()
    .reverse();
  const steps = tasks.length
    ? db
        .select({ taskId: schema.activityEvents.taskId, message: schema.activityEvents.message })
        .from(schema.activityEvents)
        .where(
          and(
            eq(schema.activityEvents.type, "tool"),
            inArray(
              schema.activityEvents.taskId,
              tasks.map((t) => t.id),
            ),
          ),
        )
        .orderBy(asc(schema.activityEvents.id))
        .all()
    : [];
  const deliverableCount = db
    .select({ id: schema.deliverables.id })
    .from(schema.deliverables)
    .where(eq(schema.deliverables.teammateId, teammateId))
    .all().length;
  const mates = db
    .select({ id: schema.teammates.id, name: schema.teammates.name })
    .from(schema.teammates)
    .where(eq(schema.teammates.businessId, businessId))
    .all();
  let memory: string | null = null;
  if (teammate.workspaceDir) {
    try {
      memory = fs.readFileSync(path.join(teammate.workspaceDir, "memory.md"), "utf8");
    } catch {
      memory = null;
    }
  }
  return { teammate, tasks, steps, deliverableCount, mates, memory };
}

function createdByLabel(createdBy: string, mates: { id: string; name: string }[]) {
  if (createdBy === "user") return "You";
  if (createdBy === "schedule") return "Scheduled";
  if (createdBy.startsWith("teammate:")) {
    const id = createdBy.slice("teammate:".length);
    return `From ${mates.find((m) => m.id === id)?.name ?? "a teammate"}`;
  }
  return createdBy;
}

const time = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function toMessages(
  businessId: string,
  tasks: Task[],
  steps: { taskId: string | null; message: string }[],
  mates: { id: string; name: string }[],
): ChatMessage[] {
  const stepsByTask = new Map<string, string[]>();
  for (const s of steps) if (s.taskId) stepsByTask.set(s.taskId, [...(stepsByTask.get(s.taskId) ?? []), s.message]);

  return tasks.flatMap((task): ChatMessage[] => {
    const mine = stepsByTask.get(task.id) ?? [];
    const user: ChatMessage = {
      id: `${task.id}-q`,
      role: "user",
      content: task.instructions,
      meta: `${createdByLabel(task.createdBy, mates)} · ${time(task.createdAt)}`,
    };
    if (task.status === "queued" || task.status === "running" || task.status === "waiting_approval") {
      const label =
        task.status === "queued" ? "Queued…" : task.status === "running" ? "Working on it…" : "Waiting for your approval";
      return [
        user,
        {
          id: `${task.id}-a`,
          role: "assistant",
          content: "",
          pending: true,
          steps: mine,
          meta: label,
        },
      ];
    }
    return [
      user,
      {
        id: `${task.id}-a`,
        role: "assistant",
        content: task.result ?? (task.status === "cancelled" ? "Cancelled." : ""),
        error: task.status === "failed",
        steps: mine,
        meta: task.finishedAt ? time(task.finishedAt) : undefined,
        footer: (
          <>
            <Badge tone={TASK_TONE[task.status]}>{task.status.replace("_", " ")}</Badge>
            {task.costUsd > 0 && <span className="text-xs text-muted-foreground">${task.costUsd.toFixed(2)}</span>}
            <Link href={`/b/${businessId}/deliverables`} className="text-xs text-muted-foreground hover:text-foreground">
              View work →
            </Link>
          </>
        ),
      },
    ];
  });
}

async function Content({ params }: Params) {
  const { id, tid } = await params;
  const [biz, data] = await Promise.all([getBusiness(id), loadTeammate(id, tid)]);
  if (!biz || !data) notFound();
  const { teammate: t, tasks, steps, deliverableCount, mates, memory } = data;
  const waiting = tasks.some((task) => task.status === "waiting_approval");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
      <LiveRefresh businessId={id} />

      <section className="flex h-[calc(100dvh-8.75rem)] min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b pb-3">
          <Link href={`/b/${id}`} className="text-xs text-muted-foreground hover:text-foreground">
            ← Office
          </Link>
          <Avatar name={t.name} color={t.color} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold tracking-tight">{t.name}</h1>
              <Badge tone={STATE_TONE[t.state]}>{t.state}</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {t.currentActivity ? <span className="italic">{t.currentActivity}</span> : t.title}
            </p>
          </div>
          {waiting && (
            <Link href={`/b/${id}/approvals`} className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">
              Needs your approval →
            </Link>
          )}
        </div>
        <Chat
          className="flex-1"
          agent={{ name: t.name, color: t.color }}
          messages={toMessages(id, tasks, steps, mates)}
          busy={false}
          sendAction={sendTaskMessage.bind(null, id, t.id)}
          placeholder={`Ask ${t.name} to work on something…`}
          suggestions={tasks.length === 0 ? t.responsibilities.slice(0, 3) : []}
          emptyState={
            <div className="py-12 text-center">
              <Avatar name={t.name} color={t.color} size={48} />
              <p className="mt-3 font-medium">
                {t.name} · {t.title}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Give {t.name} a task. Each message becomes a task, and the reply shows what was done.
              </p>
            </div>
          }
        />
      </section>

      <aside className="space-y-4 lg:pt-1">
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={t.name} color={t.color} size={44} />
            <div>
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-muted-foreground">{t.title}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-muted p-2">
              <div className="text-muted-foreground">Autonomy</div>
              <div className="font-medium capitalize">{t.autonomy}</div>
            </div>
            <div className="rounded-lg bg-muted p-2">
              <div className="text-muted-foreground">Work saved</div>
              <Link href={`/b/${id}/deliverables`} className="font-medium hover:underline">
                {deliverableCount} item{deliverableCount === 1 ? "" : "s"}
              </Link>
            </div>
          </div>
          {t.schedulePrompt && (
            <form action={runScheduledNow} className="space-y-2 border-t pt-3">
              <input type="hidden" name="businessId" value={id} />
              <input type="hidden" name="teammateId" value={t.id} />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t.schedule ? describeCron(t.schedule) : "Scheduled"}:</span>{" "}
                {t.schedulePrompt}
              </p>
              <Button variant="secondary" size="sm" className="w-full">
                Run scheduled work now
              </Button>
            </form>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Responsibilities</h2>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {t.responsibilities.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {t.kpis.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {t.kpis.map((k) => (
                <Badge key={k}>{k}</Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Memory</h2>
          <p className="text-xs text-muted-foreground">{t.name}&apos;s own notes (memory.md).</p>
          {memory ? (
            <Prose className="max-h-80 overflow-y-auto text-xs">{memory}</Prose>
          ) : (
            <p className="text-sm text-muted-foreground">No memory yet.</p>
          )}
        </Card>
      </aside>
    </div>
  );
}
