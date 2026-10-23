"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ActivityEvent } from "@/db/schema";

/**
 * Subscribe to a business's activity stream. Returns events received since mount.
 * `onEvent` fires for every new event.
 */
export function useActivity(
  businessId: string,
  onEvent?: (e: ActivityEvent) => void,
  /** Fires each time the stream (re)connects. */
  onConnect?: () => void,
) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const cb = useRef(onEvent);
  const connectCb = useRef(onConnect);
  useEffect(() => {
    cb.current = onEvent;
    connectCb.current = onConnect;
  });
  useEffect(() => {
    const es = new EventSource(`/api/b/${businessId}/events`);
    es.addEventListener("ready", () => connectCb.current?.());
    es.addEventListener("activity", (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as ActivityEvent;
      setEvents((prev) => [...prev.slice(-199), e]);
      cb.current?.(e);
    });
    return () => es.close();
  }, [businessId]);
  return events;
}

/**
 * Drop this into any server-rendered page: it calls router.refresh() (debounced)
 * whenever the worker logs activity for the business, so the page shows fresh data.
 * Pass `types` to refresh only for some event types, and `stepsOf` (a teammate id) to
 * skip other teammates' tool steps, which are the bulk of the stream during a run.
 */
export function LiveRefresh({ businessId, types, stepsOf }: { businessId: string; types?: string[]; stepsOf?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 300);
  };
  // Refresh on (re)connect too: events written between the server render and the
  // stream opening would otherwise be missed.
  useActivity(
    businessId,
    (e) => {
      if (types && !types.includes(e.type)) return;
      if (stepsOf && e.type === "tool" && e.teammateId !== stepsOf) return;
      schedule();
    },
    schedule,
  );
  return null;
}
