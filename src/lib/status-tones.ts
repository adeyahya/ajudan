import type { MessageKey } from "@/lib/i18n";

/**
 * One map from a record's status to its badge tone and label, so every page agrees
 * (UI-PLAN §2.5 "Badges"). Use with `Badge` / `StatusBadge` from @/components/kit:
 *
 *   const s = statusTone("task", task.status);   // { tone: "blue", label: "taskStatus.running" }
 *   <Badge tone={s.tone}>{t(s.label)}</Badge>
 *
 * Teammate state dots use `stateDot` (working green + pulse, waiting yellow, error red, idle grey).
 */

/** The Notion tag palette (globals.css --tag-*). */
export type TagTone = "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red";

type Entry = { tone: TagTone; label: MessageKey };

const TASK: Record<string, Entry> = {
  queued: { tone: "gray", label: "taskStatus.queued" },
  running: { tone: "blue", label: "taskStatus.running" },
  waiting_approval: { tone: "yellow", label: "taskStatus.waiting_approval" },
  waiting_human: { tone: "yellow", label: "taskStatus.waiting_human" },
  done: { tone: "green", label: "taskStatus.done" },
  failed: { tone: "red", label: "taskStatus.failed" },
  cancelled: { tone: "gray", label: "taskStatus.cancelled" },
};

const DELIVERABLE: Record<string, Entry> = {
  draft: { tone: "gray", label: "deliverableStatus.draft" },
  ready_to_post: { tone: "yellow", label: "deliverableStatus.ready_to_post" },
  approved: { tone: "blue", label: "deliverableStatus.approved" },
  published: { tone: "green", label: "deliverableStatus.published" },
  rejected: { tone: "red", label: "deliverableStatus.rejected" },
};

const APPROVAL: Record<string, Entry> = {
  pending: { tone: "yellow", label: "approvalStatus.pending" },
  approved: { tone: "green", label: "approvalStatus.approved" },
  rejected: { tone: "red", label: "approvalStatus.rejected" },
  superseded: { tone: "gray", label: "approvalStatus.superseded" },
  cancelled: { tone: "gray", label: "approvalStatus.cancelled" },
};

const BUSINESS: Record<string, Entry> = {
  onboarding: { tone: "yellow", label: "businessStatus.onboarding" },
  designing: { tone: "blue", label: "businessStatus.designing" },
  team_proposed: { tone: "purple", label: "businessStatus.team_proposed" },
  active: { tone: "green", label: "businessStatus.active" },
};

const MAPS = { task: TASK, deliverable: DELIVERABLE, approval: APPROVAL, business: BUSINESS };
export type StatusKind = keyof typeof MAPS;

/** Tone + i18n label for a status. Unknown statuses fall back to gray with the raw value as key. */
export function statusTone(kind: StatusKind, status: string): Entry {
  return MAPS[kind][status] ?? { tone: "gray", label: status as MessageKey };
}

/** Teammate state → status dot color class (8px dot; pulse only while working). */
export type DotState = "working" | "waiting" | "error" | "idle";
export const STATE_DOT: Record<DotState, string> = {
  working: "bg-success animate-pulse",
  waiting: "bg-warning",
  error: "bg-destructive",
  idle: "bg-placeholder",
};

/** Map a raw teammate.state ("working", "waiting_approval", "error", "idle", …) to a dot. */
export function stateDot(state: string | null | undefined): DotState {
  if (!state) return "idle";
  if (state === "working" || state === "running" || state === "thinking") return "working";
  if (state.startsWith("waiting")) return "waiting";
  if (state === "error" || state === "failed") return "error";
  return "idle";
}
