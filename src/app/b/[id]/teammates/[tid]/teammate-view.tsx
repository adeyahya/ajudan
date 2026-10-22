import fs from "node:fs";
import path from "node:path";
import { CornerDownRight, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { db, schema } from "@/db";
import type { Task, Teammate, TeammateState } from "@/db/schema";
import { Chat, type ChatMessage } from "@/components/chat";
import { ContextSuggestionCard, type SuggestionCardData } from "@/components/context-suggestion-card";
import { ImageStrip } from "@/components/image-strip";
import { LiveRefresh } from "@/components/live";
import { Avatar, Badge, Button, PropertyList, Prose, StatusDot, type BadgeTone } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBusiness, getProgress } from "@/lib/data";
import { resolveWorkspace } from "@/lib/paths";
import { autonomyOptions, describeCron } from "@/lib/onboarding/schedule";
import { dateLocale, t as tr, tn, uiLang, type MessageKey, type UiLang } from "@/lib/i18n";
import { scheduleStatuses } from "@/lib/schedule-context";
import { statusTone } from "@/lib/status-tones";
import { ScheduleLine } from "@/app/b/[id]/team/schedule-line";
import { DECISION, REPORT, RESULTS, REVISION } from "@/lib/manager";
import { activeWatches, watchState } from "@/lib/watches";
import { cn } from "@/lib/utils";
import { AboutPeek, TeammateMenu } from "./about-peek";
import { cancelTaskAction, retryTaskAction, runScheduledNow, sendTaskMessage } from "./actions";

const STATE_TONE: Record<TeammateState, BadgeTone> = {
  idle: "gray",
  working: "green",
  waiting: "yellow",
  error: "red",
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
  // Facts from this chat proposed for a Context page (K5 cards under the reply).
  const pageSuggestions = new Map<string, SuggestionCardData[]>();
  if (tasks.length) {
    const rows = db
      .select({ s: schema.contextSuggestions, title: schema.contextPages.title })
      .from(schema.contextSuggestions)
      .leftJoin(schema.contextPages, eq(schema.contextPages.id, schema.contextSuggestions.pageId))
      .where(inArray(schema.contextSuggestions.taskId, tasks.map((t) => t.id)))
      .orderBy(asc(schema.contextSuggestions.createdAt))
      .all();
    for (const { s, title } of rows) {
      const card: SuggestionCardData = { id: s.id, kind: s.kind, body: s.body, status: s.status, pageId: s.pageId, pageTitle: title ?? s.title ?? "" };
      pageSuggestions.set(s.taskId!, [...(pageSuggestions.get(s.taskId!) ?? []), card]);
    }
  }
  return { teammate, tasks, steps, deliverableCount, mates, memory, taskImages, children, pageSuggestions };
}

const CREATED_BY: Record<string, MessageKey> = {
  user: "mate.by.you",
  schedule: "mate.by.schedule",
  [REPORT]: "mate.by.report",
  [DECISION]: "mate.by.decision",
  [RESULTS]: "mate.by.results",
  [REVISION]: "mate.by.revision",
  "system:reply": "mate.by.reply",
  "system:capability": "mate.by.capability",
};

function createdByLabel(createdBy: string, mates: { id: string; name: string }[], lang: UiLang) {
  if (CREATED_BY[createdBy]) return tr(lang, CREATED_BY[createdBy]);
  if (createdBy.startsWith("human:")) {
    const id = createdBy.slice("human:".length);
    return tr(lang, "mate.by.human", { name: mates.find((m) => m.id === id)?.name ?? tr(lang, "mate.aPerson") });
  }
  if (createdBy.startsWith("teammate:")) {
    const id = createdBy.slice("teammate:".length);
    return tr(lang, "mate.by.teammate", { name: mates.find((m) => m.id === id)?.name ?? tr(lang, "mate.aTeammate") });
  }
  return createdBy;
}

/** "14:02" today, "12 Oct 2026, 14:02" otherwise. */
const timeIn = (lang: UiLang) => {
  const today = new Date().toDateString();
  return (d: Date) =>
    d.toDateString() === today
      ? d.toLocaleTimeString(dateLocale(lang), { timeStyle: "short" })
      : d.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });
};

/** A task status tag in the UI language. */
function TaskBadge({ status, lang }: { status: string; lang: UiLang }) {
  const s = statusTone("task", status);
  return <Badge tone={s.tone}>{tr(lang, s.label)}</Badge>;
}

/** Cancel / Retry under a task's reply (Server Functions in ./actions.ts). */
function TaskButton({ action, businessId, taskId, label }: { action: (fd: FormData) => Promise<void>; businessId: string; taskId: string; label: string }) {
  return (
    <form action={action} className="contents">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="taskId" value={taskId} />
      <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
        {label}
      </Button>
    </form>
  );
}

/** A quiet text link in a reply's action row. */
function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground", className)}
    >
      {children}
    </Link>
  );
}

function toMessages(
  businessId: string,
  tasks: Task[],
  steps: { taskId: string | null; message: string }[],
  mates: { id: string; name: string }[],
  taskImages: Map<string, string[]>,
  children: Map<string, Task[]>,
  lang: UiLang,
  pageSuggestions = new Map<string, SuggestionCardData[]>(),
): ChatMessage[] {
  const time = timeIn(lang);
  const stepsByTask = new Map<string, string[]>();
  for (const s of steps) if (s.taskId) stepsByTask.set(s.taskId, [...(stepsByTask.get(s.taskId) ?? []), s.message]);

  return tasks.flatMap((task): ChatMessage[] => {
    const mine = stepsByTask.get(task.id) ?? [];
    const handedOff = children.get(task.id) ?? [];
    const delegated = handedOff.length ? (
      <ul className="-mx-1.5 flex flex-col">
        {handedOff.map((c) => (
          <li key={c.id}>
            <Link
              href={`/b/${businessId}/teammates/${c.teammateId}`}
              className="flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-[13px] leading-[18px] text-muted-foreground transition-colors duration-100 hover:bg-hover"
            >
              <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.75} />
              <span className="shrink-0 font-medium text-foreground">{mates.find((m) => m.id === c.teammateId)?.name ?? tr(lang, "mate.teammate")}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <TaskBadge status={c.status} lang={lang} />
            </Link>
          </li>
        ))}
      </ul>
    ) : null;
    const user: ChatMessage = {
      id: `${task.id}-q`,
      role: "user",
      content: task.instructions,
      attachments: task.attachments,
      meta: `${createdByLabel(task.createdBy, mates, lang)} · ${time(task.createdAt)}`,
    };
    if (task.status === "queued" || task.status === "running" || task.status === "waiting_approval") {
      const label =
        task.status === "queued" ? tr(lang, "mate.queued") : task.status === "running" ? tr(lang, "mate.working") : tr(lang, "mate.waitingApproval");
      return [
        ...(task.createdBy === REPORT || task.createdBy === DECISION ? [] : [user]),
        {
          id: `${task.id}-a`,
          role: "assistant",
          content: "",
          pending: true,
          steps: mine,
          meta: task.createdBy === REPORT ? tr(lang, "mate.writingUpdate") : task.createdBy === DECISION ? tr(lang, "mate.followingUp") : label,
          footer: (
            <>
              {task.status === "waiting_approval" && (
                <RowLink href={`/b/${businessId}/approvals`} className="-ml-0.5 text-warning hover:text-warning">
                  <StatusDot state="waiting" className="mr-1.5" />
                  {tr(lang, "chathome.decideInInbox")}
                </RowLink>
              )}
              <TaskButton action={cancelTaskAction} businessId={businessId} taskId={task.id} label={tr(lang, "mate.cancel")} />
            </>
          ),
        },
      ];
    }
    const images = taskImages.get(task.id) ?? [];
    const suggestions = pageSuggestions.get(task.id) ?? [];
    return [
      ...(task.createdBy === REPORT || task.createdBy === DECISION ? [] : [user]),
      {
        id: `${task.id}-a`,
        role: "assistant",
        content: task.result ?? (task.status === "cancelled" ? tr(lang, "mate.cancelled") : ""),
        error: task.status === "failed",
        steps: mine,
        meta: [
          task.createdBy === REPORT ? tr(lang, "mate.by.report") : task.createdBy === DECISION ? tr(lang, "mate.by.decision") : null,
          task.finishedAt ? time(task.finishedAt) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        extras:
          suggestions.length || delegated || images.length ? (
            <>
              {suggestions.map((s) => (
                <ContextSuggestionCard key={s.id} businessId={businessId} s={s} />
              ))}
              {delegated}
              {images.length > 0 && <ImageStrip businessId={businessId} images={images} />}
            </>
          ) : undefined,
        footer: (
          <>
            <TaskBadge status={task.status} lang={lang} />
            {task.costUsd > 0 && <span className="px-1.5 tabular-nums">${task.costUsd.toFixed(2)}</span>}
            <RowLink href={`/b/${businessId}/deliverables`}>{tr(lang, "chathome.viewWork")}</RowLink>
            {(task.status === "failed" || task.status === "cancelled") && (
              <TaskButton action={retryTaskAction} businessId={businessId} taskId={task.id} label={tr(lang, "mate.retry")} />
            )}
          </>
        ),
      },
    ];
  });
}

/** The 44px bar over a conversation: who, their state, what needs the owner, and the "…" menu. */
function ConversationHeader({
  person,
  profileHref,
  badge,
  sub,
  aside,
}: {
  person: Teammate;
  profileHref: string;
  badge: ReactNode;
  sub: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
      <Link
        href={profileHref}
        scroll={false}
        className="-ml-1 flex min-w-0 shrink-0 items-center gap-2 rounded-md py-1 pr-1.5 pl-1 transition-colors duration-100 hover:bg-hover"
      >
        <Avatar seed={person.id} name={person.name} color={person.color} size={28} />
        <span className="max-w-[12rem] truncate text-sm leading-5 font-semibold text-foreground">{person.name}</span>
      </Link>
      {badge}
      <span className="hidden min-w-0 flex-1 truncate text-xs text-tertiary sm:block">{sub}</span>
      <span className="flex-1 sm:hidden" />
      {aside}
    </header>
  );
}

/**
 * A teammate's conversation. With `manager`, it's the owner's main conversation: team
 * updates appear as the manager's messages, and each reply lists what was delegated.
 * `embedded` (the chat home): only the conversation, filling its parent's height; its
 * profile opens on the manager's own page. Otherwise the profile is a side peek (`?about=1`)
 * beside the conversation.
 */
export async function TeammateView({ id, tid, manager = false, embedded = false }: { id: string; tid: string; manager?: boolean; embedded?: boolean }) {
  const [biz, data] = await Promise.all([getBusiness(id), loadTeammate(id, tid)]);
  if (!biz || !data) notFound();
  const lang = uiLang(biz.language);
  if (data.teammate.kind === "human") return <HumanView businessId={id} human={data.teammate} mates={data.mates} lang={lang} />;
  const { teammate: t, tasks, steps, deliverableCount, mates, memory, taskImages, children, pageSuggestions } = data;
  const progress = await getProgress(id);
  const trust = progress.mates[t.id]?.trust;
  const managerSuggestions = [tr(lang, "mate.suggest1"), tr(lang, "mate.suggest2"), tr(lang, "mate.suggest3")];
  const waiting = tasks.some((task) => task.status === "waiting_approval");
  // The manager's page shows whose WhatsApp replies the team is waiting for.
  const watches = manager ? activeWatches(id) : [];
  const schedule = scheduleStatuses([t]).get(t.id);
  const profileHref = `/b/${id}/teammates/${t.id}?about=1`;
  const filesHref = t.workspaceDir
    ? `/b/${id}/files?path=${encodeURIComponent(`${t.workspaceDir.replace(/^.*?(teammates\/)/, "$1")}/memory.md`)}`
    : undefined;

  const conversation = (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ConversationHeader
        person={t}
        profileHref={profileHref}
        badge={<Badge tone={STATE_TONE[t.state]}>{tr(lang, `mate.state.${t.state}`)}</Badge>}
        sub={
          <>
            {t.currentActivity || t.title}
            {trust && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="ml-2 rounded-sm tabular-nums">
                    · {tr(lang, "chathome.trustShort", { score: trust.score })}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{tr(lang, "chathome.trustTitle", { score: trust.score, good: trust.good, changes: trust.changes })}</TooltipContent>
              </Tooltip>
            )}
          </>
        }
        aside={
          <>
            {waiting && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/b/${id}/approvals`}>
                  <StatusDot state="waiting" />
                  {tr(lang, "chathome.needsApproval")}
                </Link>
              </Button>
            )}
            <TeammateMenu
              businessId={id}
              teammateId={t.id}
              profileHref={profileHref}
              filesHref={filesHref}
              teamHref={`/b/${id}/team`}
              runNow={t.schedulePrompt ? runScheduledNow : undefined}
            />
          </>
        }
      />
      <Chat
        className="flex-1"
        agent={{ id: t.id, name: t.name, color: t.color }}
        messages={toMessages(id, tasks, steps, mates, taskImages, children, lang, pageSuggestions)}
        busy={false}
        sendAction={sendTaskMessage.bind(null, id, t.id)}
        uploadBusinessId={id}
        placeholder={manager ? tr(lang, "mate.askManager", { name: t.name }) : tr(lang, "mate.askTeammate", { name: t.name })}
        suggestions={tasks.length === 0 ? (manager ? managerSuggestions : t.responsibilities.slice(0, 3)) : []}
        emptyState={
          <Intro
            person={t}
            title={manager ? tr(lang, "chathome.talkTo", { name: t.name }) : `${t.name} · ${t.title}`}
            body={manager ? tr(lang, "mate.emptyManager", { name: t.name }) : tr(lang, "mate.emptyTeammate", { name: t.name })}
          />
        }
      />
    </section>
  );

  if (embedded) {
    return (
      <>
        <LiveRefresh businessId={id} />
        {conversation}
      </>
    );
  }

  const autonomy = autonomyOptions(lang).find((o) => o.value === t.autonomy)?.label ?? t.autonomy;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <LiveRefresh businessId={id} />
      {conversation}
      <Suspense fallback={null}>
      <AboutPeek title={tr(lang, "chathome.about", { name: t.name })}>
        <PeekIdentity person={t} sub={t.title} />
        <PropertyList
          className="mt-4"
          items={[
            { label: tr(lang, "mate.autonomy"), value: autonomy },
            {
              label: tr(lang, "mate.workSaved"),
              value: (
                <Link href={`/b/${id}/deliverables`} className="rounded-sm hover:underline">
                  {tn(lang, "mate.items", deliverableCount)}
                </Link>
              ),
            },
            ...(trust ? [{ label: tr(lang, "chathome.trustLabel"), value: tr(lang, "chathome.trustShort", { score: trust.score }) }] : []),
            ...(t.schedule ? [{ label: tr(lang, "mate.scheduled"), value: describeCron(t.schedule, lang) }] : []),
          ]}
        />

        {t.schedulePrompt && (
          <PeekSection title={tr(lang, "mate.scheduled")}>
            <p className="text-[13px] leading-5 text-muted-foreground">{t.schedulePrompt}</p>
            {schedule && (
              <div className="mt-1.5 [&_p]:flex [&_p]:flex-col [&_p]:text-xs [&_p]:text-tertiary">
                <ScheduleLine s={schedule} lang={lang} />
              </div>
            )}
            <form action={runScheduledNow} className="mt-3">
              <input type="hidden" name="businessId" value={id} />
              <input type="hidden" name="teammateId" value={t.id} />
              <Button variant="secondary" size="sm">
                {tr(lang, "chathome.runNow")}
              </Button>
            </form>
          </PeekSection>
        )}

        {watches.length > 0 && (
          <PeekSection title={tr(lang, "mate.waitingReplies")}>
            <ul className="divide-y divide-border">
              {watches.slice(0, 12).map((w) => {
                const state = watchState(w);
                return (
                  <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] leading-[18px] font-medium">{w.name}</span>
                      <span className="block truncate text-xs text-tertiary">
                        {mates.find((m) => m.id === w.teammateId)?.name ?? tr(lang, "mate.team")}
                        {w.purpose ? ` · ${w.purpose}` : ""}
                      </span>
                    </span>
                    <Badge tone={state === "replied" ? "green" : state === "no reply" ? "red" : "yellow"}>
                      {tr(lang, state === "replied" ? "mate.watch.replied" : state === "no reply" ? "mate.watch.noReply" : "mate.watch.waiting")}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </PeekSection>
        )}

        {t.persona && (
          <PeekSection title={tr(lang, "mate.brief")}>
            <p className="text-[13px] leading-[22px] whitespace-pre-line text-foreground">{t.persona}</p>
          </PeekSection>
        )}

        <PeekSection title={tr(lang, "mate.responsibilities")}>
          <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 marker:text-tertiary">
            {t.responsibilities.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {t.kpis.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {t.kpis.map((k) => (
                <Badge key={k}>{k}</Badge>
              ))}
            </div>
          )}
        </PeekSection>

        <PeekSection
          title={tr(lang, "mate.memory")}
          action={
            filesHref && (
              <Link href={filesHref} className="rounded-sm text-xs text-tertiary hover:text-foreground">
                {tr(lang, "mate.openInFiles")}
              </Link>
            )
          }
        >
          {memory ? (
            <div className="rounded-lg bg-muted px-4 py-3 text-[13px] [&_p]:text-[13px]">
              <Prose>{memory}</Prose>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">{tr(lang, "mate.noMemory")}</p>
          )}
        </PeekSection>
      </AboutPeek>
      </Suspense>
    </div>
  );
}

function Intro({ person, title, body }: { person: Teammate; title: string; body: string }) {
  return (
    <div className="flex max-w-md flex-col items-center py-12 text-center">
      <Avatar seed={person.id} name={person.name} color={person.color} size={64} />
      <p className="mt-4 text-base leading-6 font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function PeekIdentity({ person, sub }: { person: Teammate; sub: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar seed={person.id} name={person.name} color={person.color} size={40} />
      <div className="min-w-0">
        <p className="truncate text-base leading-6 font-semibold text-foreground">{person.name}</p>
        <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function PeekSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-border pt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm leading-5 font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A human teammate's page: the WhatsApp conversation the AI team had with them, with
 * their photos and videos. Typing here sends them a request from the business's WhatsApp.
 */
async function HumanView({
  businessId,
  human,
  mates,
  lang,
}: {
  businessId: string;
  human: Teammate;
  mates: { id: string; name: string }[];
  lang: UiLang;
}) {
  const time = timeIn(lang);
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
  const nameOf = (tid: string | null) => (tid ? (mates.find((m) => m.id === tid)?.name ?? tr(lang, "mate.teammate")) : tr(lang, "mate.by.you"));
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
          extras: m.attachments.length ? <ImageStrip businessId={businessId} images={m.attachments} /> : undefined,
        },
  );
  const queued = requests.some((r) => r.status === "queued" || r.status === "running");
  const profileHref = `/b/${businessId}/teammates/${human.id}?about=1`;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <LiveRefresh businessId={businessId} />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationHeader
          person={human}
          profileHref={profileHref}
          badge={<Badge tone="blue">{tr(lang, "mate.personBadge")}</Badge>}
          sub={`${human.title} · +${human.phone}`}
        />
        <Chat
          className="flex-1"
          agent={{ id: human.id, name: human.name, color: human.color }}
          messages={messages}
          busy={queued}
          busyLabel={tr(lang, "mate.sendingWhatsapp")}
          sendAction={sendTaskMessage.bind(null, businessId, human.id)}
          uploadBusinessId={businessId}
          placeholder={tr(lang, "mate.sendPlaceholder", { name: human.name })}
          emptyState={<Intro person={human} title={`${human.name} · ${human.title}`} body={tr(lang, "mate.humanEmpty", { name: human.name })} />}
        />
      </section>
      <Suspense fallback={null}>
      <AboutPeek title={tr(lang, "chathome.about", { name: human.name })}>
        <PeekIdentity
          person={human}
          sub={
            <span className="inline-flex items-center gap-1.5">
              <Phone aria-hidden className="size-3.5" strokeWidth={1.75} />+{human.phone}
            </span>
          }
        />
        <PeekSection title={tr(lang, "mate.requests")}>
          {requests.length ? (
            <ul className="divide-y divide-border">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] leading-[18px] font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-tertiary">
                      {createdByLabel(r.createdBy, mates, lang)} · {time(r.createdAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <TaskBadge status={r.status} lang={lang} />
                    {(r.status === "queued" || r.status === "waiting_human") && (
                      <TaskButton action={cancelTaskAction} businessId={businessId} taskId={r.id} label={tr(lang, "mate.cancel")} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">{tr(lang, "mate.noRequests")}</p>
          )}
        </PeekSection>
        {human.responsibilities.length > 0 && (
          <PeekSection title={tr(lang, "mate.canAskFor", { name: human.name })}>
            <ul className="list-disc space-y-1 pl-4 text-[13px] leading-5 marker:text-tertiary">
              {human.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </PeekSection>
        )}
      </AboutPeek>
      </Suspense>
    </div>
  );
}
