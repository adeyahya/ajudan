import type { ActivityEvent, TeammateState } from "@/db/schema";

/** Events from the server render carry Dates; events from SSE carry ISO strings. */
export type FeedEvent = Omit<ActivityEvent, "createdAt"> & { createdAt: Date | string };

/** A one-shot office animation triggered by an activity event. `key` is the event id. */
export type OfficeEffect = {
  key: number;
  type: "delegated" | "task_done" | "task_failed" | "deliverable_saved" | "approval_requested";
  teammateId?: string | null;
  from?: string;
  to?: string;
};

export const EFFECT_TYPES: ReadonlySet<string> = new Set<OfficeEffect["type"]>([
  "delegated",
  "task_done",
  "task_failed",
  "deliverable_saved",
  "approval_requested",
]);

export const STATE_LABEL: Record<TeammateState, string> = {
  idle: "Idle",
  working: "Working",
  waiting: "Needs approval",
  error: "Error",
};

export const STATE_TONE: Record<TeammateState, "neutral" | "green" | "amber" | "red"> = {
  idle: "neutral",
  working: "green",
  waiting: "amber",
  error: "red",
};

export function relativeTime(now: number, at: Date | string) {
  const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
