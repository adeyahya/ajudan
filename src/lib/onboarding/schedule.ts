import { Cron } from "croner";
import type { Autonomy } from "@/db/schema";

/** Scheduled runs may not come closer together than this (each run is a paid Claude run). */
export const MIN_CRON_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Returns the trimmed cron expression if croner accepts it and it never fires more
 * than once an hour, else null.
 */
export function validCron(expr: string | null | undefined): string | null {
  const e = expr?.trim();
  if (!e) return null;
  try {
    const job = new Cron(e, { paused: true });
    const runs = job.nextRuns(12);
    job.stop();
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].getTime() - runs[i - 1].getTime() < MIN_CRON_INTERVAL_MS) return null;
    }
    return e;
  } catch {
    return null;
  }
}

/** When a valid schedule fires next (null for an invalid one). Paused: no timer is started. */
export function nextRunOf(expr: string | null | undefined, from = new Date()): Date | null {
  const e = expr?.trim();
  if (!e) return null;
  try {
    const job = new Cron(e, { paused: true });
    const next = job.nextRun(from);
    job.stop();
    return next;
  } catch {
    return null;
  }
}

export const AUTONOMY_OPTIONS: { value: Autonomy; label: string; help: string }[] = [
  { value: "draft", label: "Draft only", help: "Prepares work for you to review. Never takes action on its own." },
  { value: "ask", label: "Ask first", help: "Works on its own, but asks your approval before anything goes out." },
  { value: "auto", label: "Autopilot", help: "Acts on its own within its role and reports what it did." },
];

export function isAutonomy(v: unknown): v is Autonomy {
  return v === "draft" || v === "ask" || v === "auto";
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * What the schedule picker on the Team page produces: a time of day plus daily,
 * weekdays, or a set of weekdays (0 = Sunday … 6 = Saturday). "custom" is a raw cron.
 */
export type SchedulePreset =
  | { mode: "daily"; hour: number; minute: number }
  | { mode: "weekdays"; hour: number; minute: number }
  | { mode: "weekly"; days: number[]; hour: number; minute: number }
  | { mode: "custom"; expr: string };

/** Cron string for a preset (null when it has no days, or custom and empty). */
export function buildCron(p: SchedulePreset): string | null {
  if (p.mode === "custom") return p.expr.trim() || null;
  const hour = clamp(p.hour, 0, 23);
  const minute = clamp(p.minute, 0, 59);
  const time = `${minute} ${hour} * *`;
  if (p.mode === "daily") return `${time} *`;
  if (p.mode === "weekdays") return `${time} 1-5`;
  const days = [...new Set(p.days.map((d) => clamp(d, 0, 6)))].sort((a, b) => a - b);
  if (!days.length) return null;
  if (days.length === 7) return `${time} *`;
  if (days.join(",") === "1,2,3,4,5") return `${time} 1-5`;
  return `${time} ${days.join(",")}`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : lo)));
}

/** The preset a cron string came from, or custom when the picker can't express it. */
export function parseCronPreset(expr: string | null | undefined): SchedulePreset | null {
  const e = expr?.trim();
  if (!e) return null;
  const parsed = parseDaily(e);
  if (!parsed) return { mode: "custom", expr: e };
  const { hour, minute, days } = parsed;
  if (days === "*") return { mode: "daily", hour, minute };
  if (days.length === 5 && days.join(",") === "1,2,3,4,5") return { mode: "weekdays", hour, minute };
  return { mode: "weekly", days, hour, minute };
}

/** "M H * * DOW" with numeric minute/hour and a day field of *, a range, a list or 1-5. */
function parseDaily(e: string): { hour: number; minute: number; days: number[] | "*" } | null {
  const m = e.split(/\s+/);
  if (m.length !== 5) return null;
  const [min, hour, dom, mon, dow] = m;
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour) || dom !== "*" || mon !== "*") return null;
  const h = Number(hour);
  const mi = Number(min);
  if (h > 23 || mi > 59) return null;
  if (dow === "*") return { hour: h, minute: mi, days: "*" };
  const days = parseDays(dow);
  if (!days) return null;
  return { hour: h, minute: mi, days };
}

/** "1-5", "1,3,5", "6,0" or "7" (Sunday) → sorted unique 0–6, or null. */
function parseDays(dow: string): number[] | null {
  const out = new Set<number>();
  for (const part of dow.split(",")) {
    const range = part.match(/^(\d)(?:-(\d))?$/);
    if (!range) return null;
    const a = Number(range[1]);
    const b = range[2] === undefined ? a : Number(range[2]);
    if (a > 7 || b > 7 || a > b) return null;
    for (let d = a; d <= b; d++) out.add(d % 7);
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}

/** Plain-words description of the schedules the picker makes (and the common hand-written ones). */
export function describeCron(expr: string | null | undefined): string {
  if (!expr) return "No recurring work";
  const e = expr.trim();
  const p = parseDaily(e);
  if (!p) return e;
  const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  if (p.days === "*") return `Every day at ${time}`;
  if (p.days.length === 7) return `Every day at ${time}`;
  if (p.days.join(",") === "1,2,3,4,5") return `Weekdays at ${time}`;
  if (p.days.join(",") === "0,6") return `Weekends at ${time}`;
  if (p.days.length === 1) return `Every ${DAY_NAMES[p.days[0]]} at ${time}`;
  const names = p.days.map((d) => DAY_NAMES[d]);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} at ${time}`;
}
