import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Teammate } from "@/db/schema";
import type { BusinessProfile } from "@/lib/types";
import { LiveRefresh } from "@/components/live";
import { Avatar, Badge, Card, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness, listTeammates } from "@/lib/data";
import { lastEventOf } from "@/lib/onboarding/data";
import { autonomyOptions, describeCron } from "@/lib/onboarding/schedule";
import { t as tr, tn, uiLang, type UiLang } from "@/lib/i18n";
import { openRequests } from "@/lib/humans";
import { ROLE_TEMPLATES } from "@/lib/roles";
import { scheduleStatuses, type ScheduleStatus } from "@/lib/schedule-context";
import { ScheduleLine } from "./schedule-line";
import { addHuman, addTeammate, hireTeam, redesignTeam, removeTeammate, setOwnerHuman, updateHuman, updateTeammate } from "./actions";
import { AddTeammateForm, HumanForm, PendingSubmit, TeammateEditor } from "./forms";

type Params = { params: Promise<{ id: string }> };

export default function TeamPage(props: Params) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={props.params} />
    </Suspense>
  );
}

const LIVE_TYPES = ["profile_ready", "team_proposed", "team_error", "onboarding_error"];

async function Content({ params }: Params) {
  const { id } = await params;
  const biz = await getBusiness(id);
  if (!biz) notFound();
  const lang = uiLang(biz.language);

  if (biz.status === "onboarding") {
    return (
      <Card className="p-6 max-w-xl">
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        <h1 className="font-semibold mb-1">{tr(lang, "team.notDesignedTitle")}</h1>
        <p className="text-sm text-muted-foreground mb-4">{tr(lang, "team.notDesignedBody")}</p>
        <Link
          href={`/b/${id}/onboarding`}
          className="inline-flex items-center rounded-lg px-3.5 h-9 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
        >
          {tr(lang, "team.continueInterview")}
        </Link>
      </Card>
    );
  }

  if (biz.status === "designing") {
    const last = await lastEventOf(id, ["team_error", "team_proposed", "profile_ready"]);
    const failed = !biz.busy && last?.type === "team_error";
    // The profile is written and nothing is running: the owner checks it before the design starts.
    if (!biz.busy && !failed && biz.profile) {
      return (
        <div>
          <LiveRefresh businessId={id} types={[...LIVE_TYPES, "profile_updated"]} />
          <ProfileCheck businessId={id} profile={biz.profile} lang={lang} />
        </div>
      );
    }
    return (
      <Card className="p-6 max-w-xl">
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        {failed ? (
          <>
            <h1 className="font-semibold mb-1">{tr(lang, "team.designFailed")}</h1>
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{last.message.slice(0, 300)}</p>
            <form action={redesignTeam.bind(null, id)}>
              <PendingSubmit>{tr(lang, "team.tryAgain")}</PendingSubmit>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-semibold mb-1 animate-pulse">{tr(lang, "team.designing")}</h1>
            <p className="text-sm text-muted-foreground">{tr(lang, "team.designingBody", { name: biz.name })}</p>
          </>
        )}
      </Card>
    );
  }

  if (biz.status === "team_proposed") {
    const proposed = await listTeammates(id, "proposed");
    return (
      <div>
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        <PageHeader
          title={tr(lang, "team.proposedTitle")}
          subtitle={tr(lang, "team.proposedSubtitle")}
          actions={
            <div className="flex gap-2">
              <form action={redesignTeam.bind(null, id)}>
                <PendingSubmit variant="secondary">{tr(lang, "team.redesign")}</PendingSubmit>
              </form>
              <form action={hireTeam.bind(null, id)}>
                <PendingSubmit>{tr(lang, "team.hire")}</PendingSubmit>
              </form>
            </div>
          }
        />
        {biz.teamSummary && (
          <Card className="p-4 mb-6 bg-primary/5">
            <Prose>{biz.teamSummary}</Prose>
          </Card>
        )}
        <AutonomyLegend lang={lang} />
        <div className="grid gap-4 md:grid-cols-2">
          {proposed.map((t) => (
            <TeammateCard key={t.id} t={t} businessId={id} lang={lang} />
          ))}
        </div>
        {!proposed.length && <p className="text-sm text-muted-foreground">{tr(lang, "team.everyoneRemoved")}</p>}
        <p className="mt-6 text-xs text-muted-foreground">
          {tr(lang, "team.notExpected1")}{" "}
          <Link href={`/b/${id}/profile`} className="underline">
            {tr(lang, "team.notExpectedProfile")}
          </Link>
          {tr(lang, "team.notExpected2")}{" "}
          <Link href={`/b/${id}/onboarding`} className="underline">
            {tr(lang, "team.notExpectedInterview")}
          </Link>
          {tr(lang, "team.notExpected3")}
        </p>
      </div>
    );
  }

  // active
  const everyone = await listTeammates(id, "active");
  const roster = everyone.filter((t) => t.kind !== "human");
  const humans = everyone.filter((t) => t.kind === "human");
  const open = openRequests(humans.map((h) => h.id));
  const schedules = scheduleStatuses(roster);
  return (
    <div>
      <LiveRefresh
        businessId={id}
        types={[...LIVE_TYPES, "human_request_sent", "human_replied", "human_request_done", "schedule_skipped", "task_queued", "task_done", "task_failed"]}
      />
      <PageHeader
        title={tr(lang, "team.title")}
        subtitle={
          humans.length
            ? tr(lang, "team.subtitleWithPeople", { ai: tn(lang, "team.aiTeammates", roster.length), people: tn(lang, "team.people", humans.length), name: biz.name })
            : tr(lang, "team.subtitle", { ai: tn(lang, "team.aiTeammates", roster.length), name: biz.name })
        }
      />
      <AutonomyLegend lang={lang} />
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {roster.map((t) => (
          <TeammateCard key={t.id} t={t} businessId={id} active schedule={schedules.get(t.id)} lang={lang} />
        ))}
      </div>
      <Card className="p-5 mb-8">
        <h2 className="font-medium mb-3">{tr(lang, "team.addAiTitle")}</h2>
        <AddTeammateForm
          action={addTeammate.bind(null, id)}
          roles={ROLE_TEMPLATES.map(({ key, title, summary }) => ({ key, title, summary }))}
        />
      </Card>

      <h2 className="font-pixel mb-1 text-lg">{tr(lang, "team.peopleTitle")}</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{tr(lang, "team.peopleBody")}</p>
      {humans.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {humans.map((h) => (
            <HumanCard key={h.id} t={h} businessId={id} open={open.filter((r) => r.teammateId === h.id).length} isOwner={biz.ownerHumanId === h.id} lang={lang} />
          ))}
        </div>
      )}
      <Card className="p-5">
        <h2 className="font-medium mb-3">{tr(lang, "team.addPersonTitle")}</h2>
        <HumanForm action={addHuman.bind(null, id)} />
      </Card>
    </div>
  );
}

function HumanCard({ t, businessId, open, isOwner, lang }: { t: Teammate; businessId: string; open: number; isOwner: boolean; lang: UiLang }) {
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar seed={t.id} name={t.name} color={t.color} size={40} />
        <div className="min-w-0 flex-1">
          <Link href={`/b/${businessId}/teammates/${t.id}`} className="font-semibold hover:underline">
            {t.name}
          </Link>
          <div className="text-sm text-muted-foreground">{t.title}</div>
          <div className="text-xs text-muted-foreground">WhatsApp +{t.phone}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={isOwner ? "green" : "blue"}>{isOwner ? tr(lang, "team.owner") : tr(lang, "team.person")}</Badge>
          {open > 0 && <Badge tone="amber">{tn(lang, "team.openRequests", open)}</Badge>}
        </div>
      </div>
      <form action={setOwnerHuman.bind(null, businessId, isOwner ? null : t.id)} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isOwner ? (
          <>
            <span>{tr(lang, "team.ownerApprovals")}</span>
            <PendingSubmit variant="ghost">{tr(lang, "team.stop")}</PendingSubmit>
          </>
        ) : (
          <PendingSubmit variant="secondary">{tr(lang, "team.thisIsMe")}</PendingSubmit>
        )}
      </form>
      {t.responsibilities.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">{tr(lang, "team.canAskThemFor")}</div>
          <ul className="list-disc pl-5 text-sm space-y-0.5">
            {t.responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="border-t border-border pt-3">
        <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground">{tr(lang, "team.edit")}</summary>
        <div className="pt-3 grid gap-3">
          <HumanForm
            action={updateHuman.bind(null, businessId, t.id)}
            initial={{ name: t.name, title: t.title, phone: t.phone, helps: t.responsibilities }}
            submitLabel={tr(lang, "team.form.save")}
          />
          <form action={removeTeammate.bind(null, businessId, t.id)}>
            <PendingSubmit variant="ghost">{tr(lang, "team.removePerson", { name: t.name })}</PendingSubmit>
          </form>
        </div>
      </details>
    </Card>
  );
}

/** Between the interview and the team design: the owner confirms the profile the whole team will work from. */
function ProfileCheck({ businessId, profile: p, lang }: { businessId: string; profile: BusinessProfile; lang: UiLang }) {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title={tr(lang, "team.checkTitle")}
        subtitle={tr(lang, "team.checkSubtitle")}
        actions={
          <form action={redesignTeam.bind(null, businessId)}>
            <PendingSubmit>{tr(lang, "team.checkConfirm")}</PendingSubmit>
          </form>
        }
      />
      <Card className="p-6 grid gap-4">
        <div>
          <div className="font-semibold">{p.name}</div>
          <p className="text-sm">{p.oneLiner}</p>
        </div>
        <Prose>{p.description}</Prose>
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{tr(lang, "team.goals")}</div>
            {p.goals.length ? (
              <ul className="list-disc pl-5 space-y-0.5">
                {p.goals.map((g, i) => (
                  <li key={i}>
                    {g.goal} <span className="text-muted-foreground">({g.metric} → {g.target})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{tr(lang, "team.noneYet")}</p>
            )}
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{tr(lang, "team.teamNeeds")}</div>
            {p.teamNeeds.length ? (
              <ul className="list-disc pl-5 space-y-0.5">
                {p.teamNeeds.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{tr(lang, "team.noneYet")}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          <Link href={`/b/${businessId}/profile`} className="text-primary underline">
            {tr(lang, "team.editProfile")}
          </Link>
          <Link href={`/b/${businessId}/onboarding`} className="text-primary underline">
            {tr(lang, "team.addInterviewDetails")}
          </Link>
        </div>
      </Card>
    </div>
  );
}

function AutonomyLegend({ lang }: { lang: UiLang }) {
  return (
    <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      {autonomyOptions(lang).map((o) => (
        <span key={o.value}>
          <span className="font-medium text-foreground">{o.label}:</span> {o.help}
        </span>
      ))}
    </div>
  );
}

function TeammateCard({
  t,
  businessId,
  active,
  schedule,
  lang,
}: {
  t: Teammate;
  businessId: string;
  active?: boolean;
  schedule?: ScheduleStatus;
  lang: UiLang;
}) {
  const autonomy = autonomyOptions(lang).find((o) => o.value === t.autonomy);
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar seed={t.id} name={t.name} color={t.color} size={40} />
        <div className="min-w-0 flex-1">
          {active ? (
            <Link href={`/b/${businessId}/teammates/${t.id}`} className="font-semibold hover:underline">
              {t.name}
            </Link>
          ) : (
            <div className="font-semibold">{t.name}</div>
          )}
          <div className="text-sm text-muted-foreground">{t.title}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone="violet">{autonomy?.label ?? t.autonomy}</Badge>
          <span className="text-[11px] text-muted-foreground">{describeCron(t.schedule, lang)}</span>
        </div>
      </div>
      {t.why && <p className="text-sm">{t.why}</p>}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">{tr(lang, "team.brief")}</div>
        {t.persona ? (
          <p className="text-sm whitespace-pre-line">{t.persona}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{tr(lang, "team.noBrief", { name: t.name })}</p>
        )}
      </div>
      {t.responsibilities.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">{tr(lang, "team.responsibilities")}</div>
          <ul className="list-disc pl-5 text-sm space-y-0.5">
            {t.responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {t.kpis.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {t.kpis.map((k, i) => (
            <Badge key={i}>{k}</Badge>
          ))}
        </div>
      )}
      {t.schedule && t.schedulePrompt && (
        <div className="grid gap-0.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{describeCron(t.schedule, lang)}:</span> {t.schedulePrompt}
          </p>
          {schedule && <ScheduleLine s={schedule} lang={lang} />}
        </div>
      )}
      <details className="border-t border-border pt-3">
        <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground">{tr(lang, "team.edit")}</summary>
        <div className="pt-3 grid gap-3">
          <TeammateEditor
            action={updateTeammate.bind(null, businessId, t.id)}
            initial={{
              name: t.name,
              persona: t.persona,
              responsibilities: t.responsibilities,
              autonomy: t.autonomy,
              schedule: t.schedule,
              schedulePrompt: t.schedulePrompt,
              browserAccess: t.browserAccess,
              whatsappAccess: t.whatsappAccess,
              shellAccess: t.shellAccess,
            }}
          />
          <form action={removeTeammate.bind(null, businessId, t.id)}>
            <PendingSubmit variant="ghost">{active ? tr(lang, "team.archive") : tr(lang, "team.removeFromTeam")}</PendingSubmit>
          </form>
        </div>
      </details>
    </Card>
  );
}
