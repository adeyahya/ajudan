"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT, useTn } from "@/components/i18n";
import { Avatar, Badge, Card, cn } from "@/components/kit";
import { OfficeCanvas } from "./office-canvas";
import type { OfficeState, OfficeTeammate } from "./state";
import { TaskForm } from "./task-form";
import { layoutFor, TILE } from "./room";
import { type FeedEvent, relativeTime, STATE_LABEL, STATE_TONE } from "./types";
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{businessName}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tn("office.inOffice", state.teammates.length)}
            {state.queuedTasks > 0 && ` ${tr("office.queued", { count: state.queuedTasks })}`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", working ? "bg-emerald-500 animate-pulse" : "bg-border")} />
            {tr("office.working", { count: working })}
          </span>
          <span className="text-muted-foreground">·</span>
          <Link
            href={approvalsHref}
            className={cn(
              "rounded-md px-2 py-0.5",
              state.pendingApprovals
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tn("office.needApproval", state.pendingApprovals)}
          </Link>
        </div>
      </div>

      {rest && <RestBanner businessId={businessId} rest={rest} queued={state.queuedTasks} now={now} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4 min-w-0">
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
                title={fullscreen ? "Leave full screen (Esc)" : "Play full screen"}
              >
                {fullscreen ? "✕ Exit" : "⛶ Full screen"}
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

        <aside className="space-y-4 min-w-0">
          {selected && (
            <TeammatePanel businessId={businessId} teammate={selected} managerId={state.managerId} onClose={() => setSelectedId(null)} />
          )}
          <ActivityFeed feed={feed} byId={byId} now={now} />
        </aside>
      </div>
    </div>
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
        <Link href={`/b/${businessId}/studio`} className={cn(link, "bg-secondary text-foreground")}>
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
    <div className="grid gap-2 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
      {teammates.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={cn(
            "text-left rounded-xl border bg-card p-3 flex gap-3 items-start transition hover:bg-muted",
            selectedId === t.id ? "border-primary ring-2 ring-primary/30" : "border-border",
          )}
        >
          <Avatar seed={t.id} name={t.name} color={t.color} size={30} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-sm truncate">{t.name}</span>
              <Badge tone={STATE_TONE[t.state]}>{tr(STATE_LABEL[t.state])}</Badge>
            </span>
            <span className="block text-xs text-muted-foreground truncate">{t.title}</span>
            {t.currentActivity && <span className="block text-xs mt-1 line-clamp-2 md:hidden">{t.currentActivity}</span>}
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
  // Below lg the panel sits under the office; bring it into view when a teammate is picked.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [t.id]);
  return (
    <Card ref={ref} className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Avatar seed={t.id} name={t.name} color={t.color} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t.name}</div>
          <div className="text-xs text-muted-foreground">{t.title}</div>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm px-1" aria-label={tr("ui.close")}>
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Badge tone={STATE_TONE[t.state]}>{tr(STATE_LABEL[t.state])}</Badge>
        <span className="text-muted-foreground truncate">{t.currentActivity ?? (t.state === "idle" ? tr("office.readyForTask") : "")}</span>
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
    <Card className="flex flex-col max-h-[640px]">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold">{tr("office.activity")}</h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" /> {tr("office.live")}
        </span>
      </div>
      {feed.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{tr("office.feedEmpty")}</p>
      ) : (
        <ol className="overflow-y-auto divide-y divide-border">
          {feed.map((e) => {
            const tm = e.teammateId ? byId.get(e.teammateId) : undefined;
            return (
              <li key={e.id} className="px-4 py-2.5 flex gap-2.5 items-start">
                {tm ? (
                  <Avatar seed={tm.id} name={tm.name} color={tm.color} size={24} />
                ) : (
                  <span className="size-6 rounded-full bg-border shrink-0 inline-flex items-center justify-center text-[11px] text-muted-foreground">
                    ★
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-snug break-words",
                      e.type === "approval_requested" && "text-amber-700 dark:text-amber-300",
                    )}
                  >
                    {e.message}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {tm ? `${tm.name} · ` : ""}
                    {relativeTime(now, e.createdAt, lang)}
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
