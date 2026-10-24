"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT, useTn } from "@/components/i18n";
import { Avatar, Badge, Card, cn, PageBody, PageHeader, StatusDot } from "@/components/kit";
import { stateDot } from "@/lib/status-tones";
import { OfficeCanvas } from "./office-canvas";
import type { OfficeState, OfficeTeammate } from "./state";
import { TaskForm } from "./task-form";
import { layoutFor, TILE } from "./room";
import { type FeedEvent, plainText, relativeTime, STATE_LABEL, STATE_TONE } from "./types";
import { useIsDesktop, useOfficeLive } from "./use-office-live";

export function OfficeShell({
  businessId,
  businessName,
  initialState,
  initialEvents,
  initialNow,
}: {
  businessId: string;
  businessName: string;
  initialState: OfficeState;
  initialEvents: FeedEvent[];
  initialNow: number;
}) {
  const router = useRouter();
  const tr = useT();
  const tn = useTn();
  const isDesktop = useIsDesktop();
  const { state, feed, now, effects } = useOfficeLive(businessId, initialState, initialNow, initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(state.teammates.map((t) => [t.id, t])), [state.teammates]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const working = state.teammates.filter((t) => t.state === "working").length;
  const approvalsHref = `/b/${businessId}/approvals`;
  const openApprovals = useCallback(() => router.push(approvalsHref), [router, approvalsHref]);
  const room = layoutFor(state.teammates.length);
  // The rest can end between events; don't keep the team asleep past it.
  const rest = state.rest && state.rest.until > now ? state.rest : null;
  const toggleSelect = useCallback((id: string | null) => setSelectedId((cur) => (id && cur === id ? null : id)), []);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current && !!stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => {});
  }, []);

  return (
    <PageBody width="full">
      <PageHeader
        className="mb-6"
        title={businessName}
        description={
          <>
            {tn("office.inOffice", state.teammates.length)}
            {state.queuedTasks > 0 && ` ${tr("office.queued", { count: state.queuedTasks })}`}
          </>
        }
        actions={
          <>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px]">
              <StatusDot state={working ? "working" : "idle"} />
              {tr("office.working", { count: working })}
            </span>
            <Link
              href={approvalsHref}
              className={cn(
                "inline-flex h-7 items-center rounded-md border px-2.5 text-[13px] transition-colors",
                state.pendingApprovals
                  ? "border-warning/40 bg-warning/10 font-medium text-foreground hover:bg-warning/20"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {tn("office.needApproval", state.pendingApprovals)}
            </Link>
          </>
        }
      />

      {rest && <RestBanner businessId={businessId} rest={rest} queued={state.queuedTasks} now={now} />}

      <div className={cn("grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]", rest && "mt-5")}>
        <div className="min-w-0 space-y-4">
          {state.teammates.length > 0 && (
            <div
              ref={stageRef}
              className={cn("relative hidden md:block", fullscreen && "md:flex items-center justify-center bg-[#1b1420]")}
            >
              <Card
                className="relative overflow-hidden bg-[#5b4636] p-0"
                style={{
                  aspectRatio: `${room.W * TILE} / ${room.H * TILE}`,
                  ...(fullscreen ? { width: `min(100vw, 100vh * ${room.W / room.H})` } : null),
                }}
              >
                {isDesktop && (
                  <OfficeCanvas
                    businessName={businessName}
                    teammates={state.teammates}
                    pendingApprovals={state.pendingApprovals}
                    deliverableCount={state.deliverableCount}
                    resting={!!rest}
                    effects={effects}
                    selectedId={selectedId}
                    onSelect={toggleSelect}
                    onOpenApprovals={openApprovals}
                  />
                )}
              </Card>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="font-pixel absolute right-2 top-2 z-50 rounded-[4px] border-2 border-[#2a1d22] bg-[#f8f0e3]/90 px-2 py-0.5 text-xs text-[#2a1d22] shadow-[2px_2px_0_rgba(42,29,34,0.25)] hover:bg-white"
                title={tr(fullscreen ? "office.exitFullscreenTitle" : "office.fullscreenTitle")}
              >
                {fullscreen ? `✕ ${tr("office.exitFullscreen")}` : `⛶ ${tr("office.fullscreen")}`}
              </button>
              {fullscreen && rest && (
                <div className="font-pixel absolute bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-[4px] border-2 border-[#2a1d22] bg-[#241b29]/90 px-3 py-1 text-sm text-[#f8f0e3]">
                  💤 Team resting · {restUntil(rest)}
                </div>
              )}
            </div>
          )}
          <Roster teammates={state.teammates} selectedId={selectedId} onSelect={toggleSelect} />
        </div>

        {/* On xl the column is exactly as tall as the room + roster: the picked teammate on top,
            the feed fills the rest and scrolls. */}
        <aside className="relative min-w-0 xl:min-h-[480px]">
          <div className="flex flex-col gap-4 xl:absolute xl:inset-0">
            {selected && (
              <TeammatePanel businessId={businessId} teammate={selected} managerId={state.managerId} onClose={() => setSelectedId(null)} />
            )}
            <ActivityFeed feed={feed} byId={byId} now={now} />
          </div>
        </aside>
      </div>
    </PageBody>
  );
}

function restUntil(rest: NonNullable<OfficeState["rest"]>) {
  const at = new Date(rest.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return rest.known ? `back at ${at}` : `trying again at ${at}`;
}

/** Out of Claude usage: the team naps, and the owner gets the things they can do without tokens. */
function RestBanner({
  businessId,
  rest,
  queued,
  now,
}: {
  businessId: string;
  rest: NonNullable<OfficeState["rest"]>;
  queued: number;
  now: number;
}) {
  const mins = Math.max(1, Math.round((rest.until - now) / 60_000));
  const left = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const link =
    "font-pixel inline-flex items-center rounded-[4px] border-2 border-[#2a1d22] px-2.5 py-1 text-sm shadow-[2px_2px_0_rgba(42,29,34,0.25)] hover:translate-y-px";
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 border-indigo-400/40 bg-indigo-500/10 p-4">
      <div className="text-3xl" aria-hidden>
        💤
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">The team is resting: out of Claude usage</div>
        <p className="text-sm text-muted-foreground">
          {restUntil(rest)} (about {left}).{" "}
          {queued > 0 ? `${queued} task${queued === 1 ? "" : "s"} wait${queued === 1 ? "s" : ""} in the queue and start then.` : "New tasks wait in the queue until then."}{" "}
          Meanwhile you can take over, at no cost.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/b/${businessId}/desk`} className={cn(link, "bg-amber-400 text-[#2a1d22]")}>
          🎧 Answer customers yourself
        </Link>
        <Link href={`/b/${businessId}/library`} className={cn(link, "bg-secondary text-foreground")}>
          ✦ Studio: organize, edit, plan
        </Link>
        <Link href={`/b/${businessId}/approvals`} className={cn(link, "bg-secondary text-foreground")}>
          ✉ Approvals
        </Link>
        <Link href={`/b/${businessId}/deliverables`} className={cn(link, "bg-secondary text-foreground")}>
          ▤ Review work
        </Link>
      </div>
    </Card>
  );
}

function Roster({
  teammates,
  selectedId,
  onSelect,
}: {
  teammates: OfficeTeammate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const tr = useT();
  if (!teammates.length) {
    return <Card className="p-4 text-sm text-muted-foreground">{tr("office.noTeammates")}</Card>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
      {teammates.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          aria-pressed={selectedId === t.id}
          title={`${t.name} · ${tr(STATE_LABEL[t.state])}`}
          className={cn(
            "flex items-center gap-2.5 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted",
            selectedId === t.id ? "border-primary ring-2 ring-primary/25" : "border-border",
          )}
        >
          <Avatar seed={t.id} name={t.name} color={t.color} size={32} status={stateDot(t.state)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{t.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{t.title}</span>
            {t.currentActivity && <span className="mt-1 block line-clamp-2 text-xs md:hidden">{t.currentActivity}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function TeammatePanel({
  businessId,
  teammate: t,
  managerId,
  onClose,
}: {
  businessId: string;
  teammate: OfficeTeammate;
  managerId: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tr = useT();
  // Below xl the panel sits under the office; bring it into view when a teammate is picked.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1280px)").matches) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [t.id]);
  return (
    <Card ref={ref} className="shrink-0 space-y-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar seed={t.id} name={t.name} color={t.color} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{t.name}</div>
          <div className="truncate text-xs text-muted-foreground">{t.title}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mt-1 -mr-1 inline-flex size-7 items-center justify-center rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={tr("ui.close")}
        >
          ✕
        </button>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <Badge tone={STATE_TONE[t.state]}>{tr(STATE_LABEL[t.state])}</Badge>
        <span className="line-clamp-2 min-w-0 text-muted-foreground">
          {t.currentActivity ?? (t.state === "idle" ? tr("office.readyForTask") : "")}
        </span>
      </div>
      {t.state === "waiting" && (
        <Link href={`/b/${businessId}/approvals`} className="block text-sm text-amber-700 dark:text-amber-300 hover:underline">
          {tr("office.reviewApproval")}
        </Link>
      )}
      <TaskForm key={t.id} businessId={businessId} teammateId={t.id} name={t.name} viaManager={!!managerId && managerId !== t.id} />
      <Link href={`/b/${businessId}/teammates/${t.id}`} className="block text-sm text-primary hover:underline">
        {tr("office.openPage", { name: t.name })}
      </Link>
    </Card>
  );
}

function ActivityFeed({ feed, byId, now }: { feed: FeedEvent[]; byId: Map<string, OfficeTeammate>; now: number }) {
  const tr = useT();
  const lang = useLang();
  return (
    <Card className="flex max-h-[560px] min-h-0 flex-col xl:max-h-none xl:flex-1">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{tr("office.activity")}</h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot state="working" className="size-1.5" /> {tr("office.live")}
        </span>
      </div>
      {feed.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{tr("office.feedEmpty")}</p>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {feed.map((e) => {
            const tm = e.teammateId ? byId.get(e.teammateId) : undefined;
            const text = plainText(e.message);
            return (
              <li key={e.id} className="flex items-start gap-2.5 px-4 py-3">
                {tm ? (
                  <Avatar seed={tm.id} name={tm.name} color={tm.color} size={24} />
                ) : (
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground">
                    ★
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                    {tm && <span className="truncate font-medium text-foreground">{tm.name}</span>}
                    <span className="shrink-0">{relativeTime(now, e.createdAt, lang)}</span>
                  </p>
                  <p
                    title={text}
                    className={cn(
                      "mt-0.5 line-clamp-3 text-[13px] leading-[18px] [overflow-wrap:anywhere]",
                      e.type === "approval_requested" && "text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {text}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
