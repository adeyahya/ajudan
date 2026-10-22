import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { Task, TaskStatus, Teammate, TeammateState } from "@/db/schema";
import { Chat, type ChatMessage } from "@/components/chat";
import { ImageStrip } from "@/components/image-strip";
import { LiveRefresh } from "@/components/live";
import { Avatar, Badge, Button, Card, Prose } from "@/components/kit";
import { getBusiness } from "@/lib/data";
import { resolveWorkspace } from "@/lib/paths";
import { describeCron } from "@/lib/onboarding/schedule";
import { DECISION, REPORT } from "@/lib/manager";
import { activeWatches, watchState } from "@/lib/watches";
import { cancelTaskAction, retryTaskAction, runScheduledNow, sendTaskMessage } from "./actions";

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
  waiting_human: "amber",
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
  // Images each task produced, shown under its reply.
  const taskImages = new Map<string, string[]>();
  if (tasks.length) {
    for (const d of db
      .select({ taskId: schema.deliverables.taskId, attachments: schema.deliverables.attachments })
      .from(schema.deliverables)
      .where(
        inArray(
          schema.deliverables.taskId,
          tasks.map((t) => t.id),
        ),
      )
      .all()) {
      if (d.taskId && d.attachments.length) taskImages.set(d.taskId, [...(taskImages.get(d.taskId) ?? []), ...d.attachments]);
    }
  }
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
      memory = fs.readFileSync(path.join(resolveWorkspace(teammate.workspaceDir), "memory.md"), "utf8");
    } catch {
      memory = null;
    }
  }
  // Work handed off from each task (the manager's delegations).
  const children = new Map<string, Task[]>();
  if (tasks.length) {
    for (const c of db
      .select()
      .from(schema.tasks)
      .where(
        inArray(
          schema.tasks.parentTaskId,
          tasks.map((t) => t.id),
        ),
      )
      .all()) {
      if (c.createdBy === REPORT || !c.parentTaskId) continue;
      children.set(c.parentTaskId, [...(children.get(c.parentTaskId) ?? []), c]);
    }
  }
  // A team update shows the images its delegated tasks produced.
  const childIds = [...children.values()].flat().map((c) => c.id);
  if (childIds.length) {
    const byTask = new Map<string, string[]>();
    for (const d of db
      .select({ taskId: schema.deliverables.taskId, attachments: schema.deliverables.attachments })
      .from(schema.deliverables)
      .where(inArray(schema.deliverables.taskId, childIds))
      .all()) {
      if (d.taskId && d.attachments.length) byTask.set(d.taskId, [...(byTask.get(d.taskId) ?? []), ...d.attachments]);
    }
    for (const t of tasks) {
      if (t.createdBy !== REPORT || !t.parentTaskId) continue;
      const imgs = (children.get(t.parentTaskId) ?? []).flatMap((c) => byTask.get(c.id) ?? []);
      if (imgs.length) taskImages.set(t.id, [...(taskImages.get(t.id) ?? []), ...imgs]);
    }
  }
  return { teammate, tasks, steps, deliverableCount, mates, memory, taskImages, children };
}

function createdByLabel(createdBy: string, mates: { id: string; name: string }[]) {
  if (createdBy === "user") return "You";
  if (createdBy === "schedule") return "Scheduled";
  if (createdBy === REPORT) return "Team update";
  if (createdBy === DECISION) return "After your decision";
  if (createdBy === "system:reply") return "WhatsApp reply";
  if (createdBy === "system:capability") return "You approved";
  if (createdBy.startsWith("human:")) {
    const id = createdBy.slice("human:".length);
    return `From ${mates.find((m) => m.id === id)?.name ?? "a person"} (WhatsApp)`;
  }
  if (createdBy.startsWith("teammate:")) {
    const id = createdBy.slice("teammate:".length);
    return `From ${mates.find((m) => m.id === id)?.name ?? "a teammate"}`;
  }
  return createdBy;
}

const time = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Cancel / Retry under a task's reply (Server Functions in ./actions.ts). */
function TaskButton({ action, businessId, taskId, label }: { action: (fd: FormData) => Promise<void>; businessId: string; taskId: string; label: string }) {
  return (
    <form action={action} className="contents">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="taskId" value={taskId} />
      <Button type="submit" variant="ghost" size="xs">
        {label}
      </Button>
    </form>
  );
}

function toMessages(
  businessId: string,
  tasks: Task[],
  steps: { taskId: string | null; message: string }[],
  mates: { id: string; name: string }[],
  taskImages: Map<string, string[]>,
  children: Map<string, Task[]> = new Map(),
): ChatMessage[] {
  const stepsByTask = new Map<string, string[]>();
  for (const s of steps) if (s.taskId) stepsByTask.set(s.taskId, [...(stepsByTask.get(s.taskId) ?? []), s.message]);

  return tasks.flatMap((task): ChatMessage[] => {
    const mine = stepsByTask.get(task.id) ?? [];
    const handedOff = children.get(task.id) ?? [];
    const delegated = handedOff.length ? (
      <div className="w-full space-y-1 pb-1">
        {handedOff.map((c) => (
          <Link
            key={c.id}
            href={`/b/${businessId}/teammates/${c.teammateId}`}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden>↳</span>
            <span className="font-pixel text-foreground">{mates.find((m) => m.id === c.teammateId)?.name ?? "Teammate"}</span>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            <Badge tone={TASK_TONE[c.status]}>{c.status.replace("_", " ")}</Badge>
          </Link>
        ))}
      </div>
    ) : null;
    const user: ChatMessage = {
      id: `${task.id}-q`,
      role: "user",
      content: task.instructions,
      attachments: task.attachments,
      meta: `${createdByLabel(task.createdBy, mates)} · ${time(task.createdAt)}`,
    };
    if (task.status === "queued" || task.status === "running" || task.status === "waiting_approval") {
      const label =
        task.status === "queued" ? "Queued…" : task.status === "running" ? "Working on it…" : "Waiting for your approval";
      return [
        ...(task.createdBy === REPORT || task.createdBy === DECISION ? [] : [user]),
        {
          id: `${task.id}-a`,
          role: "assistant",
          content: "",
          pending: true,
          steps: mine,
          meta: task.createdBy === REPORT ? "Writing the team update…" : task.createdBy === DECISION ? "Following up on your decision…" : label,
          footer: (
            <>
              {task.status === "waiting_approval" && (
                <Link href={`/b/${businessId}/approvals`} className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400">
                  Decide on the Approvals page →
                </Link>
              )}
              <TaskButton action={cancelTaskAction} businessId={businessId} taskId={task.id} label="Cancel" />
            </>
          ),
        },
      ];
    }
    return [
      ...(task.createdBy === REPORT || task.createdBy === DECISION ? [] : [user]),
      {
        id: `${task.id}-a`,
        role: "assistant",
        content: task.result ?? (task.status === "cancelled" ? "Cancelled." : ""),
        error: task.status === "failed",
        steps: mine,
        meta: [task.createdBy === REPORT ? "Team update" : task.createdBy === DECISION ? "After your decision" : null, task.finishedAt ? time(task.finishedAt) : null]
          .filter(Boolean)
          .join(" · "),
        footer: (
          <>
            {delegated}
            {(taskImages.get(task.id)?.length ?? 0) > 0 && (
              <ImageStrip businessId={businessId} images={taskImages.get(task.id)!} className="w-full pb-1" />
            )}
            <Badge tone={TASK_TONE[task.status]}>{task.status.replace("_", " ")}</Badge>
            {task.costUsd > 0 && <span className="text-xs text-muted-foreground">${task.costUsd.toFixed(2)}</span>}
            <Link href={`/b/${businessId}/deliverables`} className="text-xs text-muted-foreground hover:text-foreground">
              View work →
            </Link>
            {(task.status === "failed" || task.status === "cancelled") && (
              <TaskButton action={retryTaskAction} businessId={businessId} taskId={task.id} label="Retry" />
            )}
          </>
        ),
      },
    ];
  });
}

/**
 * A teammate's chat page. With `manager`, it's the owner's main conversation: team
 * updates appear as the manager's messages, and each reply lists what was delegated.
 */
export async function TeammateView({ id, tid, manager = false }: { id: string; tid: string; manager?: boolean }) {
  const [biz, data] = await Promise.all([getBusiness(id), loadTeammate(id, tid)]);
  if (!biz || !data) notFound();
  if (data.teammate.kind === "human") return <HumanView businessId={id} human={data.teammate} mates={data.mates} />;
  const { teammate: t, tasks, steps, deliverableCount, mates, memory, taskImages, children } = data;
  const id_ = biz.language === "id";
  const managerSuggestions = id_
    ? ["Apa yang sedang dikerjakan tim?", "Siapkan konten minggu ini untuk TikTok dan Instagram", "Ada yang perlu saya setujui?"]
    : ["What is the team working on?", "Plan this week's TikTok and Instagram content", "Is anything waiting for my approval?"];
  const waiting = tasks.some((task) => task.status === "waiting_approval");
  // The manager's page shows whose WhatsApp replies the team is waiting for.
  const watches = manager ? activeWatches(id) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
      <LiveRefresh businessId={id} />

      <section className="flex h-[calc(100dvh-8.75rem)] min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b pb-3">
          <Link href={`/b/${id}`} className="text-xs text-muted-foreground hover:text-foreground">
            ← Office
          </Link>
          <Avatar seed={t.id} name={t.name} color={t.color} size={36} />
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
          agent={{ id: t.id, name: t.name, color: t.color }}
          messages={toMessages(id, tasks, steps, mates, taskImages, children)}
          busy={false}
          sendAction={sendTaskMessage.bind(null, id, t.id)}
          uploadBusinessId={id}
          placeholder={manager ? `Ask ${t.name} anything; the team will handle it…` : `Ask ${t.name} to work on something…`}
          suggestions={tasks.length === 0 ? (manager ? managerSuggestions : t.responsibilities.slice(0, 3)) : []}
          emptyState={
            <div className="py-12 text-center">
              <Avatar seed={t.id} name={t.name} color={t.color} size={48} />
              <p className="mt-3 font-medium">
                {t.name} · {t.title}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {manager
                  ? `${t.name} is your manager. Ask for anything: ${t.name} hands it to the right teammates and reports back here when it's done. Drop footage or photos into the chat to send them along.`
                  : `Give ${t.name} a task. Each message becomes a task, and the reply shows what was done. Drop footage or photos into the chat to attach them.`}
              </p>
            </div>
          }
        />
      </section>

      <aside className="space-y-4 lg:pt-1">
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar seed={t.id} name={t.name} color={t.color} size={44} />
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

        {watches.length > 0 && (
          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">Waiting for replies</h2>
            <ul className="space-y-2 text-sm">
              {watches.slice(0, 12).map((w) => {
                const state = watchState(w);
                return (
                  <li key={w.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate">{w.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {mates.find((m) => m.id === w.teammateId)?.name ?? "Team"}
                        {w.purpose ? ` · ${w.purpose}` : ""}
                      </span>
                    </span>
                    <Badge tone={state === "replied" ? "green" : state === "no reply" ? "red" : "amber"}>{state}</Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

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
          <p className="text-xs text-muted-foreground">
            {t.name}&apos;s own notes (memory.md).{" "}
            {t.workspaceDir && (
              <Link href={`/b/${id}/files?path=${encodeURIComponent(`${t.workspaceDir.replace(/^.*?(teammates\/)/, "$1")}/memory.md`)}`} className="underline hover:text-foreground">
                Open in Files
              </Link>
            )}
          </p>
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

/**
 * A human teammate's page: the WhatsApp conversation the AI team had with them, with
 * their photos and videos. Typing here sends them a request from the business's WhatsApp.
 */
async function HumanView({ businessId, human, mates }: { businessId: string; human: Teammate; mates: { id: string; name: string }[] }) {
  const rows = db
    .select()
    .from(schema.humanMessages)
    .where(eq(schema.humanMessages.humanId, human.id))
    .orderBy(desc(schema.humanMessages.sentAt))
    .limit(60)
    .all()
    .reverse();
  const requests = db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.teammateId, human.id))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(10)
    .all();
  const nameOf = (tid: string | null) => (tid ? (mates.find((m) => m.id === tid)?.name ?? "Teammate") : "You");
  const messages: ChatMessage[] = rows.map((m) =>
    m.direction === "out"
      ? {
          id: m.id,
          role: "user",
          content: m.text,
          attachments: m.attachments,
          meta: `${nameOf(m.fromTeammateId)} → ${human.name} · ${time(m.sentAt)}`,
        }
      : {
          id: m.id,
          role: "assistant",
          content: m.text,
          meta: `WhatsApp · ${time(m.sentAt)}`,
          footer: m.attachments.length ? (
            <ImageStrip businessId={businessId} images={m.attachments} className="w-full pb-1" />
          ) : undefined,
        },
  );
  const queued = requests.some((r) => r.status === "queued" || r.status === "running");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_19rem]">
      <LiveRefresh businessId={businessId} />
      <section className="flex h-[calc(100dvh-8.75rem)] min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b pb-3">
          <Link href={`/b/${businessId}/team`} className="text-xs text-muted-foreground hover:text-foreground">
            ← Team
          </Link>
          <Avatar seed={human.id} name={human.name} color={human.color} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold tracking-tight">{human.name}</h1>
              <Badge tone="blue">Person · WhatsApp</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {human.title} · +{human.phone}
            </p>
          </div>
        </div>
        <Chat
          className="flex-1"
          agent={{ id: human.id, name: human.name, color: human.color }}
          messages={messages}
          busy={queued}
          busyLabel="Sending on WhatsApp…"
          sendAction={sendTaskMessage.bind(null, businessId, human.id)}
          uploadBusinessId={businessId}
          placeholder={`Send ${human.name} a request on WhatsApp…`}
          emptyState={
            <div className="py-12 text-center">
              <Avatar seed={human.id} name={human.name} color={human.color} size={48} />
              <p className="mt-3 font-medium">
                {human.name} · {human.title}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                The AI team asks {human.name} for help on WhatsApp, and you&apos;ll see the conversation here. Their replies, photos and
                videos go back to whoever asked. You can send a request yourself too; replies to yours go to the manager.
              </p>
            </div>
          }
        />
      </section>
      <aside className="space-y-4 lg:pt-1">
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Requests</h2>
          {requests.length ? (
            <ul className="space-y-2 text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{createdByLabel(r.createdBy, mates)} · {time(r.createdAt)}</span>
                  </span>
                  <Badge tone={TASK_TONE[r.status]}>{r.status === "waiting_human" ? "waiting" : r.status.replace("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          )}
        </Card>
        {human.responsibilities.length > 0 && (
          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">The team can ask {human.name} for</h2>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {human.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}
