"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useActivity } from "@/components/live";
import type { ActivityEvent } from "@/db/schema";
import type { OfficeState } from "./state";
import { EFFECT_TYPES, type FeedEvent, type OfficeEffect } from "./types";

const DESKTOP_QUERY = "(min-width: 768px)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True at >=768px. False during SSR, so the office canvas only mounts on wide screens in the browser. */
export function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

/**
 * The office, live: state refetched from /api/b/[id]/state after each worker event, the
 * activity feed (newest first), short-lived canvas effects and a ticking clock. Shared by
 * the full office and the strip above the chat.
 */
export function useOfficeLive(businessId: string, initialState: OfficeState, initialNow: number, initialEvents: FeedEvent[] = []) {
  const [state, setState] = useState(initialState);
  const [feed, setFeed] = useState<FeedEvent[]>(() => [...initialEvents].reverse());
  const [now, setNow] = useState(initialNow);
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

  return { state, feed, now, effects };
}
