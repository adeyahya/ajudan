import { CalendarClock, CircleDot, Info, Loader2, MessageSquare, Phone, Shield, Target, Type, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import type { Teammate } from "@/db/schema";
import type { BusinessProfile } from "@/lib/types";
import { LiveRefresh } from "@/components/live";
import { DataTable, type Column } from "@/components/data-table";
import { SidePeekLayout } from "@/components/side-peek";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  LineTabs,
  PageBody,
  PageHeader,
  Prose,
  PropertyList,
  Section,
  Skeleton,
  StatusDot,
  TableSkeleton,
} from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBusiness, listTeammates } from "@/lib/data";
import { lastEventOf } from "@/lib/onboarding/data";
import { autonomyOptions, describeCron } from "@/lib/onboarding/schedule";
import { t as tr, tn, uiLang, type MessageKey, type UiLang } from "@/lib/i18n";
import { openRequests } from "@/lib/humans";
import { ROLE_TEMPLATES } from "@/lib/roles";
import { scheduleStatuses, type ScheduleStatus } from "@/lib/schedule-context";
import { stateDot, type DotState } from "@/lib/status-tones";
import { ActionForm, SubmitButton } from "./action-form";
import {
  addHuman,
  addTeammate,
  hireTeam,
  redesignTeam,
  removeTeammate,
  setOwnerHuman,
  setTeammateAccess,
  updateHuman,
  updateTeammate,
} from "./actions";
import { nextRunShort, ScheduleLine } from "./schedule-line";
import {
  AccessSwitches,
  AddPersonDialog,
  AddTeammateDialog,
  EditPersonDialog,
  EditTeammateDialog,
  OwnerButton,
  RemoveButton,
  RemoveMenu,
  RunNowButton,
  TeamPeek,
} from "./team-client";

/**
 * Team: before hiring, the design flow (profile check → designing → proposed team);
 * after, a Notion-style database of AI teammates and people, each opening in a side peek
 * (`?t=<id>`), with Add / Edit in dialogs.
 */
export default function TeamPage(props: PageProps<"/b/[id]/team">) {
  return (
    <Suspense
      fallback={
        <PageBody width="wide">
          <Skeleton className="h-[34px] w-48 rounded-md" />
          <Skeleton className="mt-3 h-4 w-72 max-w-full" />
          <TableSkeleton rows={5} cols={5} className="mt-12" />
        </PageBody>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}

const LIVE_TYPES = ["profile_ready", "team_proposed", "team_error", "onboarding_error"];

async function Content({ params, searchParams }: PageProps<"/b/[id]/team">) {
  const { id } = await params;
  const sp = await searchParams;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const lang = uiLang(biz.language);

  if (biz.status === "onboarding") {
    return (
      <PageBody>
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        <EmptyState
          icon={<Users />}
          title={tr(lang, "team.notDesignedTitle")}
          body={tr(lang, "team.notDesignedBody")}
          action={
            <Button asChild size="sm">
              <Link href={`/b/${id}/onboarding`}>{tr(lang, "team.continueInterview")}</Link>
            </Button>
          }
        />
      </PageBody>
    );
  }

  if (biz.status === "designing") {
    const last = await lastEventOf(id, ["team_error", "team_proposed", "profile_ready"]);
    const failed = !biz.busy && last?.type === "team_error";
    // The profile is written and nothing is running: the owner checks it before the design starts.
    if (!biz.busy && !failed && biz.profile) {
      return (
        <PageBody>
          <LiveRefresh businessId={id} types={[...LIVE_TYPES, "profile_updated"]} />
          <ProfileCheck businessId={id} profile={biz.profile} lang={lang} />
        </PageBody>
      );
    }
    return (
      <PageBody>
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        {failed ? (
          <>
            <PageHeader title={tr(lang, "team.designFailed")} />
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive-soft p-3">
              <p className="min-w-0 flex-1 text-[13px] leading-5 break-words text-destructive">{last.message.slice(0, 300)}</p>
              <ActionForm action={redesignTeam.bind(null, id)}>
                <SubmitButton size="sm" variant="secondary">
                  {tr(lang, "team.tryAgain")}
                </SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Loader2 className="animate-spin motion-reduce:animate-none" />}
            title={tr(lang, "team.designing")}
            body={tr(lang, "team.designingBody", { name: biz.name })}
          />
        )}
      </PageBody>
    );
  }

  if (biz.status === "team_proposed") {
    const proposed = await listTeammates(id, "proposed");
    return (
      <PageBody width="wide">
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        <PageHeader title={tr(lang, "team.proposedTitle")} description={tr(lang, "team.proposedSubtitle")} />
        {biz.teamSummary && (
          <div className="mb-8 rounded-lg bg-muted p-4 text-[15px] leading-[26px]">
            <Prose>{biz.teamSummary}</Prose>
          </div>
        )}
        {proposed.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {proposed.map((t) => (
              <ProposalCard key={t.id} t={t} businessId={id} lang={lang} />
            ))}
          </div>
        ) : (
          <EmptyState compact icon={<Users />} title={tr(lang, "team.everyoneRemoved")} />
        )}
        <p className="mt-6 max-w-[70ch] text-xs leading-5 text-muted-foreground">
          {tr(lang, "team.notExpected1")}{" "}
          <Link href={`/b/${id}/profile`} className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
            {tr(lang, "team.notExpectedProfile")}
          </Link>
          {tr(lang, "team.notExpected2")}{" "}
          <Link href={`/b/${id}/onboarding`} className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
            {tr(lang, "team.notExpectedInterview")}
          </Link>
          {tr(lang, "team.notExpected3")}
        </p>
        <div className="sticky bottom-[calc(var(--bottombar-h)+16px)] z-10 mt-8 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-background/95 p-2.5 shadow-menu backdrop-blur-sm">
          <span className="mr-auto pl-1.5 text-[13px] text-muted-foreground">{tn(lang, "team.aiTeammates", proposed.length)}</span>
          <ActionForm action={redesignTeam.bind(null, id)} success={tr(lang, "team.toast.redesigning")}>
            <SubmitButton size="sm" variant="secondary">
              {tr(lang, "team.redesign")}
            </SubmitButton>
          </ActionForm>
          <ActionForm action={hireTeam.bind(null, id)}>
            <SubmitButton size="sm">{tr(lang, "team.hire")}</SubmitButton>
          </ActionForm>
        </div>
      </PageBody>
    );
  }

  // active
  const everyone = await listTeammates(id, "active");
  const roster = everyone.filter((t) => t.kind !== "human");
  const humans = everyone.filter((t) => t.kind === "human");
  const open = openRequests(humans.map((h) => h.id));
  const schedules = scheduleStatuses(roster);
  const tab = sp.tab === "people" ? "people" : "ai";
  const selId = typeof sp.t === "string" ? sp.t : null;
  const selected = everyone.find((t) => t.id === selId);
  const peekHref = (t: Teammate) => `?${new URLSearchParams({ ...(tab === "people" ? { tab } : {}), t: t.id })}`;
  const options = autonomyOptions(lang);
  const roles = ROLE_TEMPLATES.map(({ key, title, summary }) => ({ key, title, summary }));

  const nameCell = (t: Teammate) => (
    <span className="flex min-w-0 items-center gap-2.5 py-1.5">
      <Avatar seed={t.id} name={t.name} color={t.color} size={32} />
      <span className="min-w-0">
        <span className="block truncate">{t.name}</span>
        <span className="block truncate text-xs leading-4 font-normal text-muted-foreground">{t.title}</span>
      </span>
    </span>
  );

  const aiColumns: Column<Teammate>[] = [
    { key: "name", header: tr(lang, "team.col.name"), icon: <Type />, cell: nameCell, title: (t) => `${t.name} · ${t.title}` },
    {
      key: "freedom",
      header: (
        <span className="inline-flex items-center gap-1">
          {tr(lang, "team.col.freedom")}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={tr(lang, "team.freedomHelp")} className="rounded-sm text-tertiary hover:text-foreground">
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72 flex-col items-start gap-1 py-2 text-left">
              {options.map((o) => (
                <span key={o.value} className="block">
                  <b className="font-semibold">{o.label}:</b> {o.help}
                </span>
              ))}
            </TooltipContent>
          </Tooltip>
        </span>
      ),
      icon: <Shield />,
      width: 124,
      cell: (t) => <Badge tone="purple">{options.find((o) => o.value === t.autonomy)?.label ?? t.autonomy}</Badge>,
    },
    {
      key: "schedule",
      header: tr(lang, "team.col.schedule"),
      icon: <CalendarClock />,
      width: 210,
      title: (t) => (t.schedule ? describeCron(t.schedule, lang) : undefined),
      cell: (t) =>
        t.schedule && t.schedulePrompt ? (
          <span className="block min-w-0">
            <span className="block truncate">{describeCron(t.schedule, lang)}</span>
            {nextRunShort(schedules.get(t.id), lang) && (
              <span className="block truncate text-xs text-tertiary">{tr(lang, "team.nextShort", { when: nextRunShort(schedules.get(t.id), lang)! })}</span>
            )}
          </span>
        ) : (
          <span className="text-tertiary">—</span>
        ),
    },
    { key: "status", header: tr(lang, "team.col.status"), icon: <CircleDot />, width: 116, cell: (t) => <StateCell state={t.state} lang={lang} /> },
    {
      key: "kpis",
      header: tr(lang, "team.col.kpis"),
      icon: <Target />,
      width: 72,
      align: "right",
      cell: (t) => (t.kpis.length ? t.kpis.length : <span className="text-tertiary">—</span>),
      title: (t) => t.kpis.join(", "),
    },
  ];

  const peopleColumns: Column<Teammate>[] = [
    { key: "name", header: tr(lang, "team.col.name"), icon: <Type />, cell: nameCell, title: (t) => `${t.name} · ${t.title}` },
    { key: "phone", header: "WhatsApp", icon: <Phone />, width: 170, cell: (t) => (t.phone ? <span className="tabular-nums">+{t.phone}</span> : "—") },
    {
      key: "requests",
      header: tr(lang, "team.col.requests"),
      icon: <MessageSquare />,
      width: 150,
      cell: (t) => {
        const n = open.filter((r) => r.teammateId === t.id).length;
        return n ? <Badge tone="yellow">{tn(lang, "team.openRequests", n)}</Badge> : <span className="text-tertiary">—</span>;
      },
    },
    {
      key: "owner",
      header: tr(lang, "team.owner"),
      icon: <Users />,
      width: 150,
      cell: (t) =>
        biz.ownerHumanId === t.id ? (
          <Badge tone="green">{tr(lang, "team.owner")}</Badge>
        ) : (
          <OwnerButton set={setOwnerHuman.bind(null, id, t.id)} isOwner={false} />
        ),
    },
  ];

  return (
    <SidePeekLayout
      peek={
        <TeamPeek
          title={selected?.name}
          openHref={selected ? `/b/${id}/teammates/${selected.id}` : undefined}
          actions={selected && <PeekActions t={selected} businessId={id} lang={lang} />}
        >
          {selected &&
            (selected.kind === "human" ? (
              <PersonPeek t={selected} businessId={id} isOwner={biz.ownerHumanId === selected.id} open={open.filter((r) => r.teammateId === selected.id).length} lang={lang} />
            ) : (
              <TeammatePeek t={selected} businessId={id} schedule={schedules.get(selected.id)} lang={lang} />
            ))}
        </TeamPeek>
      }
    >
      <PageBody width="wide">
        <LiveRefresh
          businessId={id}
          types={[...LIVE_TYPES, "human_request_sent", "human_replied", "human_request_done", "schedule_skipped", "task_queued", "task_done", "task_failed", "task_started"]}
        />
        <PageHeader
          title={tr(lang, "team.title")}
          description={
            humans.length
              ? tr(lang, "team.subtitleWithPeople", { ai: tn(lang, "team.aiTeammates", roster.length), people: tn(lang, "team.people", humans.length), name: biz.name })
              : tr(lang, "team.subtitle", { ai: tn(lang, "team.aiTeammates", roster.length), name: biz.name })
          }
          actions={
            <>
              <AddPersonDialog action={addHuman.bind(null, id)} />
              <AddTeammateDialog action={addTeammate.bind(null, id)} roles={roles} />
            </>
          }
        />
        <LineTabs
          className="mb-1"
          label={tr(lang, "team.title")}
          items={[
            { href: "?tab=ai", label: tr(lang, "team.tab.ai"), active: tab === "ai", count: roster.length },
            { href: "?tab=people", label: tr(lang, "team.tab.people"), active: tab === "people", count: humans.length },
          ]}
        />
        {tab === "ai" ? (
          <DataTable
            label={tr(lang, "team.tab.ai")}
            rows={roster}
            columns={aiColumns}
            getRowId={(t) => t.id}
            rowHref={peekHref}
            selectedId={selected?.id}
            minWidth={700}
            empty={<EmptyState icon={<Users />} title={tr(lang, "team.emptyAi")} body={tr(lang, "team.emptyAiBody")} />}
          />
        ) : (
          <>
            <p className="mt-3 mb-2 max-w-[70ch] text-[13px] leading-5 text-muted-foreground">{tr(lang, "team.peopleBody")}</p>
            <DataTable
              label={tr(lang, "team.tab.people")}
              rows={humans}
              columns={peopleColumns}
              getRowId={(t) => t.id}
              rowHref={peekHref}
              selectedId={selected?.id}
              minWidth={680}
              empty={
                <EmptyState
                  icon={<Phone />}
                  title={tr(lang, "team.emptyPeople")}
                  body={tr(lang, "team.emptyPeopleBody")}
                  action={<AddPersonDialog action={addHuman.bind(null, id)} full />}
                />
              }
            />
          </>
        )}
      </PageBody>
    </SidePeekLayout>
  );
}

const STATE_LABEL: Record<DotState, MessageKey> = {
  working: "team.state.working",
  waiting: "team.state.waiting",
  error: "team.state.error",
  idle: "team.state.idle",
};

function StateCell({ state, lang }: { state: string; lang: UiLang }) {
  const dot = stateDot(state);
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot state={dot} />
      <span className={dot === "idle" ? "text-muted-foreground" : undefined}>{tr(lang, STATE_LABEL[dot])}</span>
    </span>
  );
}

function PeekActions({ t, businessId, lang }: { t: Teammate; businessId: string; lang: UiLang }) {
  if (t.kind === "human") {
    return (
      <>
        <EditPersonDialog
          action={updateHuman.bind(null, businessId, t.id)}
          initial={{ name: t.name, title: t.title, phone: t.phone, helps: t.responsibilities }}
        />
        <RemoveMenu
          remove={removeTeammate.bind(null, businessId, t.id)}
          itemLabel={tr(lang, "team.removePersonShort")}
          confirmTitle={tr(lang, "team.removePerson", { name: t.name })}
          confirmBody={tr(lang, "team.removePersonBody")}
          confirmLabel={tr(lang, "team.removePersonShort")}
          success={tr(lang, "team.toast.removed", { name: t.name })}
        />
      </>
    );
  }
  return (
    <>
      <EditTeammateDialog action={updateTeammate.bind(null, businessId, t.id)} initial={editorInitial(t)} />
      <RemoveMenu
        remove={removeTeammate.bind(null, businessId, t.id)}
        itemLabel={tr(lang, "team.archive")}
        confirmTitle={tr(lang, "team.archiveTitle", { name: t.name })}
        confirmBody={tr(lang, "team.archiveBody")}
        confirmLabel={tr(lang, "team.archiveConfirm")}
        success={tr(lang, "team.toast.archived", { name: t.name })}
      />
    </>
  );
}

const editorInitial = (t: Teammate) => ({
  name: t.name,
  persona: t.persona,
  responsibilities: t.responsibilities,
  autonomy: t.autonomy,
  schedule: t.schedule,
  schedulePrompt: t.schedulePrompt,
  browserAccess: t.browserAccess,
  whatsappAccess: t.whatsappAccess,
  shellAccess: t.shellAccess,
});

function PeekSection({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-sm leading-5 font-semibold text-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-[13px] leading-5 text-foreground marker:text-tertiary">
      {items.map((r, i) => (
        <li key={i}>{r}</li>
      ))}
    </ul>
  );
}

function PeekHeader({ t, businessId, lang, sub }: { t: Teammate; businessId: string; lang: UiLang; sub?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar seed={t.id} name={t.name} color={t.color} size={40} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg leading-6 font-semibold text-foreground">{t.name}</h2>
        <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{t.title}</p>
        {sub}
      </div>
      <Button asChild size="sm">
        <Link href={`/b/${businessId}/teammates/${t.id}`}>
          <MessageSquare />
          {tr(lang, "team.openChat")}
        </Link>
      </Button>
    </div>
  );
}

function TeammatePeek({ t, businessId, schedule, lang }: { t: Teammate; businessId: string; schedule?: ScheduleStatus; lang: UiLang }) {
  const autonomy = autonomyOptions(lang).find((o) => o.value === t.autonomy);
  const labels = { browser: tr(lang, "team.access.browser"), whatsapp: tr(lang, "team.access.whatsapp"), shell: tr(lang, "team.access.shell") };
  const help = { browser: tr(lang, "team.form.browserHelp"), whatsapp: tr(lang, "team.form.whatsappHelp"), shell: tr(lang, "team.form.shellHelp") };
  return (
    <div>
      <PeekHeader t={t} businessId={businessId} lang={lang} />
      <PropertyList
        className="mt-5"
        items={[
          { icon: <Shield />, label: tr(lang, "team.col.freedom"), value: <Badge tone="purple" title={autonomy?.help}>{autonomy?.label ?? t.autonomy}</Badge> },
          { icon: <CircleDot />, label: tr(lang, "team.col.status"), value: <StateCell state={t.state} lang={lang} /> },
          {
            icon: <CalendarClock />,
            label: tr(lang, "team.col.schedule"),
            value: t.schedule && t.schedulePrompt ? describeCron(t.schedule, lang) : <span className="text-tertiary">{tr(lang, "team.noSchedule")}</span>,
          },
        ]}
      />
      {t.currentActivity && t.state !== "idle" && <p className="mt-3 text-[13px] text-muted-foreground italic">{t.currentActivity}</p>}

      <PeekSection title={tr(lang, "team.brief")}>
        {t.persona ? (
          <p className="text-[13px] leading-[22px] whitespace-pre-line text-foreground">{t.persona}</p>
        ) : (
          <p className="text-[13px] leading-5 text-muted-foreground">{tr(lang, "team.noBrief", { name: t.name })}</p>
        )}
      </PeekSection>

      {t.responsibilities.length > 0 && (
        <PeekSection title={tr(lang, "team.responsibilities")}>
          <Bullets items={t.responsibilities} />
        </PeekSection>
      )}

      {t.kpis.length > 0 && (
        <PeekSection title={tr(lang, "team.col.kpis")}>
          <div className="flex flex-wrap gap-1.5">
            {t.kpis.map((k, i) => (
              <Badge key={i} className="h-auto max-w-full py-0.5 whitespace-normal">
                {k}
              </Badge>
            ))}
          </div>
        </PeekSection>
      )}

      {t.schedule && t.schedulePrompt && (
        <PeekSection title={tr(lang, "team.col.schedule")} actions={<RunNowButton businessId={businessId} teammateId={t.id} />}>
          <p className="text-[13px] leading-5 text-foreground">
            <span className="font-medium">{describeCron(t.schedule, lang)}:</span> {t.schedulePrompt}
          </p>
          {schedule && <div className="mt-1.5"><ScheduleLine s={schedule} lang={lang} /></div>}
        </PeekSection>
      )}

      <PeekSection title={tr(lang, "team.peek.access")}>
        <AccessSwitches
          values={{ browser: t.browserAccess, whatsapp: t.whatsappAccess, shell: t.shellAccess }}
          toggle={setTeammateAccess.bind(null, businessId, t.id)}
          labels={labels}
          help={help}
        />
      </PeekSection>
    </div>
  );
}

function PersonPeek({ t, businessId, isOwner, open, lang }: { t: Teammate; businessId: string; isOwner: boolean; open: number; lang: UiLang }) {
  return (
    <div>
      <PeekHeader t={t} businessId={businessId} lang={lang} />
      <PropertyList
        className="mt-5"
        items={[
          { icon: <Phone />, label: "WhatsApp", value: t.phone ? <span className="tabular-nums">+{t.phone}</span> : "—" },
          {
            icon: <MessageSquare />,
            label: tr(lang, "team.col.requests"),
            value: open ? <Badge tone="yellow">{tn(lang, "team.openRequests", open)}</Badge> : <span className="text-tertiary">{tr(lang, "team.noOpenRequests")}</span>,
          },
          {
            icon: <Users />,
            label: tr(lang, "team.owner"),
            value: (
              <span className="flex items-center gap-2">
                {isOwner && <Badge tone="green">{tr(lang, "team.owner")}</Badge>}
                <OwnerButton set={setOwnerHuman.bind(null, businessId, isOwner ? null : t.id)} isOwner={isOwner} />
              </span>
            ),
          },
        ]}
      />
      <p className="mt-3 text-xs leading-[18px] text-muted-foreground">{isOwner ? tr(lang, "team.ownerApprovals") : tr(lang, "team.thisIsMe")}</p>
      <PeekSection title={tr(lang, "team.canAskThemFor")}>
        {t.responsibilities.length ? <Bullets items={t.responsibilities} /> : <p className="text-[13px] text-muted-foreground">{tr(lang, "team.noneYet")}</p>}
      </PeekSection>
    </div>
  );
}

/** A proposed teammate, before hiring: read, rename, adjust, or remove. */
function ProposalCard({ t, businessId, lang }: { t: Teammate; businessId: string; lang: UiLang }) {
  const autonomy = autonomyOptions(lang).find((o) => o.value === t.autonomy);
  return (
    <article className="flex flex-col rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <Avatar seed={t.id} name={t.name} color={t.color} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm leading-5 font-semibold text-foreground">{t.name}</h2>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{t.title}</p>
        </div>
        <Badge tone="purple" title={autonomy?.help}>
          {autonomy?.label ?? t.autonomy}
        </Badge>
      </div>
      {t.why && <p className="mt-3 text-[13px] leading-5 text-foreground">{t.why}</p>}
      {t.responsibilities.length > 0 && (
        <div className="mt-3">
          <Bullets items={t.responsibilities} />
        </div>
      )}
      {t.schedule && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5 text-tertiary" />
          {describeCron(t.schedule, lang)}
        </p>
      )}
      <div className="mt-auto flex items-center gap-1 pt-4">
        <EditTeammateDialog action={updateTeammate.bind(null, businessId, t.id)} initial={editorInitial(t)} asButton />
        <RemoveButton
          remove={removeTeammate.bind(null, businessId, t.id)}
          label={tr(lang, "team.remove")}
          confirmTitle={tr(lang, "team.removeProposed", { name: t.name })}
          success={tr(lang, "team.toast.removed", { name: t.name })}
        />
      </div>
    </article>
  );
}

/** Between the interview and the team design: the owner confirms the profile the whole team will work from. */
function ProfileCheck({ businessId, profile: p, lang }: { businessId: string; profile: BusinessProfile; lang: UiLang }) {
  return (
    <>
      <PageHeader
        title={tr(lang, "team.checkTitle")}
        description={tr(lang, "team.checkSubtitle")}
        actions={
          <ActionForm action={redesignTeam.bind(null, businessId)}>
            <SubmitButton size="sm">{tr(lang, "team.checkConfirm")}</SubmitButton>
          </ActionForm>
        }
      />
      <PropertyList
        items={[
          { icon: <Type />, label: tr(lang, "profile.form.name"), value: p.name },
          ...(p.oneLiner ? [{ icon: <Info />, label: tr(lang, "profile.form.oneLiner"), value: <span className="py-1.5">{p.oneLiner}</span> }] : []),
        ]}
      />
      <div className="mt-6 text-[15px] leading-[26px]">
        <Prose>{p.description}</Prose>
      </div>
      <div className="mt-8 grid gap-x-8 sm:grid-cols-2">
        <Section title={tr(lang, "team.goals")}>
          {p.goals.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-[22px] marker:text-tertiary">
              {p.goals.map((g, i) => (
                <li key={i}>
                  {g.goal}{" "}
                  <span className="text-muted-foreground">
                    ({g.metric} → {g.target})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{tr(lang, "team.noneYet")}</p>
          )}
        </Section>
        <Section title={tr(lang, "team.teamNeeds")} className="sm:mt-0">
          {p.teamNeeds.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-[22px] marker:text-tertiary">
              {p.teamNeeds.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{tr(lang, "team.noneYet")}</p>
          )}
        </Section>
      </div>
      <div className="mt-8 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button asChild size="sm" variant="secondary">
          <Link href={`/b/${businessId}/profile`}>{tr(lang, "team.editProfile")}</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/b/${businessId}/onboarding`}>{tr(lang, "team.addInterviewDetails")}</Link>
        </Button>
      </div>
    </>
  );
}
