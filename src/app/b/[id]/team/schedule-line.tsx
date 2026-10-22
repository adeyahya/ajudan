import type { ScheduleStatus } from "@/lib/schedule-context";

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "Next run · last run · last skipped" under a scheduled teammate's prompt. */
export function ScheduleLine({ s }: { s: ScheduleStatus }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      <span>Next run {s.nextRun ? when(s.nextRun) : "—"}</span>
      <span> · last run {s.lastRun ? when(s.lastRun) : "never"}</span>
      {s.lastSkipped && <span className="text-amber-700 dark:text-amber-300"> · last skipped {when(s.lastSkipped)}</span>}
    </p>
  );
}
