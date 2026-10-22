import { dateLocale, t, type UiLang } from "@/lib/i18n";
import type { ScheduleStatus } from "@/lib/schedule-context";

const when = (d: Date, lang: UiLang) => d.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });

/** "Next run · last run · last skipped" for a scheduled teammate. */
export function ScheduleLine({ s, lang }: { s: ScheduleStatus; lang: UiLang }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span>{t(lang, "team.nextRun", { when: s.nextRun ? when(s.nextRun, lang) : "—" })}</span>
      <span>{t(lang, "team.lastRun", { when: s.lastRun ? when(s.lastRun, lang) : t(lang, "team.never") })}</span>
      {s.lastSkipped && <span className="text-warning">{t(lang, "team.lastSkipped", { when: when(s.lastSkipped, lang) })}</span>}
    </p>
  );
}

/** Just the next run, short ("Mon 09:00"), for a table cell. */
export function nextRunShort(s: ScheduleStatus | undefined, lang: UiLang) {
  if (!s?.nextRun) return null;
  return s.nextRun.toLocaleString(dateLocale(lang), { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
