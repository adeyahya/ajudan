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

export const AUTONOMY_OPTIONS: { value: Autonomy; label: string; help: string }[] = [
  { value: "draft", label: "Draft only", help: "Prepares work for you to review. Never takes action on its own." },
  { value: "ask", label: "Ask first", help: "Works on its own, but asks your approval before anything goes out." },
  { value: "auto", label: "Autopilot", help: "Acts on its own within its role and reports what it did." },
];

export function isAutonomy(v: unknown): v is Autonomy {
  return v === "draft" || v === "ask" || v === "auto";
}

/** Plain-words description of common weekly/daily cron patterns. */
export function describeCron(expr: string | null | undefined): string {
  if (!expr) return "No recurring work";
  const m = expr.trim().split(/\s+/);
  if (m.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = m;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const time = /^\d+$/.test(hour) && /^\d+$/.test(min) ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : null;
  if (time && dom === "*" && mon === "*") {
    if (dow === "*") return `Every day at ${time}`;
    if (/^\d$/.test(dow)) return `Every ${days[Number(dow) % 7]} at ${time}`;
    if (dow === "1-5") return `Weekdays at ${time}`;
  }
  return expr;
}
