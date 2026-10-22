import { dateLocale, t, type UiLang } from "@/lib/i18n";
import type { ScheduleStatus } from "@/lib/schedule-context";

/** "Next run · last run · last skipped" under a scheduled teammate's prompt. */
export function ScheduleLine({ s, lang }: { s: ScheduleStatus; lang: UiLang }) {
  const when = (d: Date) => d.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  return (
    <p className="text-[11px] text-muted-foreground">
      <span>{t(lang, "team.nextRun", { when: s.nextRun ? when(s.nextRun) : "—" })}</span>
      <span>{t(lang, "team.lastRun", { when: s.lastRun ? when(s.lastRun) : t(lang, "team.never") })}</span>
      {s.lastSkipped && <span className="text-amber-700 dark:text-amber-300">{t(lang, "team.lastSkipped", { when: when(s.lastSkipped) })}</span>}
    </p>
  );
}
