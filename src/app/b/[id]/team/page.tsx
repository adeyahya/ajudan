import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Teammate } from "@/db/schema";
import { LiveRefresh } from "@/components/live";
import { Avatar, Badge, Card, PageHeader, PageSkeleton, Prose } from "@/components/kit";
import { getBusiness, listTeammates } from "@/lib/data";
import { lastEventOf } from "@/lib/onboarding/data";
import { AUTONOMY_OPTIONS, describeCron } from "@/lib/onboarding/schedule";
import { ROLE_TEMPLATES } from "@/lib/roles";
import { addTeammate, hireTeam, redesignTeam, removeTeammate, updateTeammate } from "./actions";
import { AddTeammateForm, PendingSubmit, TeammateEditor } from "./forms";

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

  if (biz.status === "onboarding") {
    return (
      <Card className="p-6 max-w-xl">
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        <h1 className="font-semibold mb-1">Your team isn&apos;t designed yet</h1>
        <p className="text-sm text-muted-foreground mb-4">Finish the interview first so we know what your business needs.</p>
        <Link
          href={`/b/${id}/onboarding`}
          className="inline-flex items-center rounded-lg px-3.5 h-9 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
        >
          Continue the interview
        </Link>
      </Card>
    );
  }

  if (biz.status === "designing") {
    const last = await lastEventOf(id, ["team_error", "team_proposed", "profile_ready"]);
    const failed = !biz.busy && last?.type === "team_error";
    return (
      <Card className="p-6 max-w-xl">
        <LiveRefresh businessId={id} types={LIVE_TYPES} />
        {failed ? (
          <>
            <h1 className="font-semibold mb-1">Team design failed</h1>
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{last.message.slice(0, 300)}</p>
            <form action={redesignTeam.bind(null, id)}>
              <PendingSubmit>Try again</PendingSubmit>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-semibold mb-1 animate-pulse">Designing your team…</h1>
            <p className="text-sm text-muted-foreground">
              We&apos;re picking the right teammates for {biz.name}&apos;s goals. This takes a minute.
            </p>
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
          title="Meet your proposed team"
          subtitle="Rename anyone, adjust how much freedom they get, then hire the team."
          actions={
            <div className="flex gap-2">
              <form action={redesignTeam.bind(null, id)}>
                <PendingSubmit variant="secondary">Redesign team</PendingSubmit>
              </form>
              <form action={hireTeam.bind(null, id)}>
                <PendingSubmit>Hire team</PendingSubmit>
              </form>
            </div>
          }
        />
        {biz.teamSummary && (
          <Card className="p-4 mb-6 bg-primary/5">
            <Prose>{biz.teamSummary}</Prose>
          </Card>
        )}
        <AutonomyLegend />
        <div className="grid gap-4 md:grid-cols-2">
          {proposed.map((t) => (
            <TeammateCard key={t.id} t={t} businessId={id} />
          ))}
        </div>
        {!proposed.length && <p className="text-sm text-muted-foreground">Everyone was removed. Redesign the team to start over.</p>}
      </div>
    );
  }

  // active
  const roster = await listTeammates(id, "active");
  return (
    <div>
      <LiveRefresh businessId={id} types={LIVE_TYPES} />
      <PageHeader title="Your team" subtitle={`${roster.length} teammates working for ${biz.name}`} />
      <AutonomyLegend />
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {roster.map((t) => (
          <TeammateCard key={t.id} t={t} businessId={id} active />
        ))}
      </div>
      <Card className="p-5">
        <h2 className="font-medium mb-3">Add a teammate</h2>
        <AddTeammateForm
          action={addTeammate.bind(null, id)}
          roles={ROLE_TEMPLATES.map(({ key, title, summary }) => ({ key, title, summary }))}
        />
      </Card>
    </div>
  );
}

function AutonomyLegend() {
  return (
    <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      {AUTONOMY_OPTIONS.map((o) => (
        <span key={o.value}>
          <span className="font-medium text-foreground">{o.label}:</span> {o.help}
        </span>
      ))}
    </div>
  );
}

function TeammateCard({ t, businessId, active }: { t: Teammate; businessId: string; active?: boolean }) {
  const autonomy = AUTONOMY_OPTIONS.find((o) => o.value === t.autonomy);
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
          <span className="text-[11px] text-muted-foreground">{describeCron(t.schedule)}</span>
        </div>
      </div>
      {t.why && <p className="text-sm">{t.why}</p>}
      {t.responsibilities.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Responsibilities</div>
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
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{describeCron(t.schedule)}:</span> {t.schedulePrompt}
        </p>
      )}
      <details className="border-t border-border pt-3">
        <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground">Edit</summary>
        <div className="pt-3 grid gap-3">
          <TeammateEditor
            action={updateTeammate.bind(null, businessId, t.id)}
            initial={{
              name: t.name,
              autonomy: t.autonomy,
              schedule: t.schedule,
              schedulePrompt: t.schedulePrompt,
              browserAccess: t.browserAccess,
              whatsappAccess: t.whatsappAccess,
            }}
          />
          <form action={removeTeammate.bind(null, businessId, t.id)}>
            <PendingSubmit variant="ghost">{active ? "Archive teammate" : "Remove from team"}</PendingSubmit>
          </form>
        </div>
      </details>
    </Card>
  );
}
