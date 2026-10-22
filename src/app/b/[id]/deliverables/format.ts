import type { Deliverable } from "@/db/schema";
import { dateLocale } from "@/lib/i18n";

/** "social_post" → "Social post" (kinds are free-form, written by teammates). */
export function kindLabel(kind: string) {
  const s = kind.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** When the piece last changed: the latest revision, else when it was saved. */
export function updatedAt(d: Pick<Deliverable, "createdAt" | "versions">) {
  const last = d.versions.at(-1)?.savedAt;
  return last ? new Date(last) : d.createdAt;
}

/**
 * Notion-style relative time in the UI language: "just now", "5 min ago", "3 hr ago",
 * "yesterday", "4 days ago", then a short date ("12 Oct"). Server-rendered only.
 */
export function relativeTime(date: Date, lang: string, now = Date.now()) {
  const locale = dateLocale(lang);
  const s = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), "day");
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

/** Full timestamp for a tooltip. */
export function fullTime(date: Date, lang: string) {
  return date.toLocaleString(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });
}
