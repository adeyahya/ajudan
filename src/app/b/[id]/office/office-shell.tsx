"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useActivity } from "@/components/live";
import { Avatar, Badge, Card, cn } from "@/components/kit";
import type { ActivityEvent } from "@/db/schema";
import { OfficeCanvas } from "./office-canvas";
import type { OfficeState, OfficeTeammate } from "./state";
import { TaskForm } from "./task-form";
import { layoutFor, TILE } from "./room";
import { EFFECT_TYPES, type FeedEvent, type OfficeEffect, relativeTime, STATE_LABEL, STATE_TONE } from "./types";

const DESKTOP_QUERY = "(min-width: 768px)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True at >=768px. False during SSR, so the office canvas only mounts on wide screens in the browser. */
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

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
  const isDesktop = useIsDesktop();
  const [state, setState] = useState(initialState);
  const [feed, setFeed] = useState<FeedEvent[]>(() => [...initialEvents].reverse());
  const [now, setNow] = useState(initialNow);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [effects, setEffects] = useState<OfficeEffect[]>([]);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchSeq = useRef(0);

  const refetch = useCallback(() => {
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(async () => {
      const seq = ++fetchSeq.current;
      try {
        const res = await fetch(`/api/b/${businessId}/state`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as OfficeState;
        if (seq === fetchSeq.current) setState(next);
      } catch {
        // Network blip: the next event refetches again.
      }
    }, 300);
  }, [businessId]);

  useActivity(businessId, (e: ActivityEvent) => {
    setFeed((prev) => (prev.some((p) => p.id === e.id) ? prev : [e, ...prev].slice(0, 100)));
    setNow(Date.now());
    if (EFFECT_TYPES.has(e.type)) {
      const data = (e.data ?? {}) as { from?: unknown; to?: unknown };
      const fx: OfficeEffect = {
        key: e.id,
        type: e.type as OfficeEffect["type"],
        teammateId: e.teammateId,
        from: typeof data.from === "string" ? data.from : undefined,
        to: typeof data.to === "string" ? data.to : undefined,
      };
      if (fx.type !== "delegated" || (fx.from && fx.to)) {
        setEffects((prev) => [...prev, fx].slice(-30));
        setTimeout(() => setEffects((prev) => prev.filter((x) => x.key !== fx.key)), 8000);
      }
    }
    refetch();
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(t);
      clearTimeout(refetchTimer.current);
    };
  }, []);

  const byId = useMemo(() => new Map(state.teammates.map((t) => [t.id, t])), [state.teammates]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const working = state.teammates.filter((t) => t.state === "working").length;
  const approvalsHref = `/b/${businessId}/approvals`;
  const openApprovals = useCallback(() => router.push(approvalsHref), [router, approvalsHref]);
  const room = layoutFor(state.teammates.length);
  const toggleSelect = useCallback((id: string | null) => setSelectedId((cur) => (id && cur === id ? null : id)), []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{businessName}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {state.teammates.length} teammates in the office
            {state.queuedTasks > 0 && ` · ${state.queuedTasks} queued`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", working ? "bg-emerald-500 animate-pulse" : "bg-border")} />
            {working} working
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
            {state.pendingApprovals} {state.pendingApprovals === 1 ? "needs" : "need"} approval
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4 min-w-0">
          {state.teammates.length > 0 && (
            <Card
              className="relative hidden md:block overflow-hidden bg-[#5b4636] p-0"
              style={{ aspectRatio: `${room.W * TILE} / ${room.H * TILE}` }}
            >
              {isDesktop && (
                <OfficeCanvas
                  businessName={businessName}
                  teammates={state.teammates}
                  pendingApprovals={state.pendingApprovals}
                  deliverableCount={state.deliverableCount}
                  effects={effects}
                  selectedId={selectedId}
                  onSelect={toggleSelect}
                  onOpenApprovals={openApprovals}
                />
              )}
            </Card>
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

function Roster({
  teammates,
  selectedId,
  onSelect,
}: {
  teammates: OfficeTeammate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!teammates.length) {
    return <Card className="p-4 text-sm text-muted-foreground">No active teammates yet.</Card>;
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
              <Badge tone={STATE_TONE[t.state]}>{STATE_LABEL[t.state]}</Badge>
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
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm px-1" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Badge tone={STATE_TONE[t.state]}>{STATE_LABEL[t.state]}</Badge>
        <span className="text-muted-foreground truncate">{t.currentActivity ?? (t.state === "idle" ? "Ready for a task" : "")}</span>
      </div>
      {t.state === "waiting" && (
        <Link href={`/b/${businessId}/approvals`} className="block text-sm text-amber-700 dark:text-amber-300 hover:underline">
          Review the pending approval →
        </Link>
      )}
      <TaskForm key={t.id} businessId={businessId} teammateId={t.id} name={t.name} viaManager={!!managerId && managerId !== t.id} />
      <Link href={`/b/${businessId}/teammates/${t.id}`} className="block text-sm text-primary hover:underline">
        Open {t.name}&apos;s page →
      </Link>
    </Card>
  );
}

function ActivityFeed({ feed, byId, now }: { feed: FeedEvent[]; byId: Map<string, OfficeTeammate>; now: number }) {
  return (
    <Card className="flex flex-col max-h-[640px]">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" /> live
        </span>
      </div>
      {feed.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nothing yet. Give a teammate a task to get started.</p>
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
                    {relativeTime(now, e.createdAt)}
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
