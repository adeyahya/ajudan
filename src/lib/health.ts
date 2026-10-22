import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/db";
import type { Job } from "@/db/schema";
import { spentByTeammate, spentThisWeek, spentToday, startOfDay, startOfWeek } from "@/lib/budget";
import { uiLang } from "@/lib/i18n";
import { laneOf, type Lane } from "@/lib/jobs";
import { backupsDir, currentDataDir } from "@/lib/paths";
import { workerHealth, type WorkerHealth } from "@/lib/worker-heartbeat";

/**
 * What the Health page (/b/[id]/health) shows: the worker's heartbeat, the job
 * queue, recent failures, spend and the last daily backup. Read helpers for Server
 * Components (they await connection() like src/lib/data.ts).
 */

const RECENT = 20;

export type QueueJob = {
  id: number;
  kind: Job["kind"];
  status: "queued" | "running";
  lane: Lane;
  attempts: number;
  /** Queued: since it was created; running: since it started. */
  sinceMs: number;
  /** For run_task jobs: the task and who runs it. */
  task: { id: string; title: string; teammateId: string; teammate: string } | null;
};

export async function getWorkerHealth(): Promise<WorkerHealth | null> {
  await connection();
  const dir = currentDataDir();
  return dir ? workerHealth(dir) : null;
}

/** Queued and running jobs, oldest first. Jobs are per folder; task details are added for this business's tasks. */
export async function getQueue(businessId: string, now = Date.now()): Promise<QueueJob[]> {
  await connection();
  const jobs = db.select().from(schema.jobs).where(inArray(schema.jobs.status, ["queued", "running"])).orderBy(schema.jobs.id).all();
  const taskIds = jobs.map((j) => String((j.payload as { taskId?: string }).taskId ?? "")).filter(Boolean);
  const tasks = taskIds.length
    ? db
        .select({ id: schema.tasks.id, title: schema.tasks.title, teammateId: schema.tasks.teammateId, teammate: schema.teammates.name })
        .from(schema.tasks)
        .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
        .where(and(inArray(schema.tasks.id, taskIds), eq(schema.tasks.businessId, businessId)))
        .all()
    : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return jobs.map((j) => {
    const status = j.status as "queued" | "running";
    const from = status === "running" && j.startedAt ? j.startedAt : j.createdAt;
    return {
      id: j.id,
      kind: j.kind,
      status,
      lane: laneOf(j),
      attempts: j.attempts,
      sinceMs: Math.max(0, now - from.getTime()),
      task: byId.get(String((j.payload as { taskId?: string }).taskId ?? "")) ?? null,
    };
  });
}

/** Failed tasks of the business (newest first) and failed jobs in the folder. */
export async function getFailures(businessId: string) {
  await connection();
  const tasks = db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      result: schema.tasks.result,
      finishedAt: schema.tasks.finishedAt,
      teammateId: schema.tasks.teammateId,
      teammate: schema.teammates.name,
      createdBy: schema.tasks.createdBy,
    })
    .from(schema.tasks)
    .innerJoin(schema.teammates, eq(schema.teammates.id, schema.tasks.teammateId))
    .where(and(eq(schema.tasks.businessId, businessId), eq(schema.tasks.status, "failed")))
    .orderBy(desc(schema.tasks.finishedAt), desc(schema.tasks.createdAt))
    .limit(RECENT)
    .all();
  const jobs = db
    .select({ id: schema.jobs.id, kind: schema.jobs.kind, error: schema.jobs.error, attempts: schema.jobs.attempts, finishedAt: schema.jobs.finishedAt, payload: schema.jobs.payload })
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "failed"))
    .orderBy(desc(schema.jobs.id))
    .limit(RECENT)
    .all()
    .map((j) => ({ ...j, taskId: String((j.payload as { taskId?: string }).taskId ?? "") || null }));
  return { tasks, jobs };
}

/** Today's and this week's spend, in total and per teammate. */
export async function getSpendRollup(businessId: string, now = new Date()) {
  await connection();
  const cap = db.select({ cap: schema.businesses.dailyBudgetUsd }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).get()?.cap ?? 0;
  return {
    cap,
    today: spentToday(businessId, now),
    week: spentThisWeek(businessId, now),
    byTeammateToday: spentByTeammate(businessId, startOfDay(now)),
    byTeammateWeek: spentByTeammate(businessId, startOfWeek(now)),
  };
}

const DAILY = /^daily-(\d{4}-\d{2}-\d{2})\.db$/;

/** The newest daily backup (worker/maintenance.ts), or null when there is none yet. */
export function latestDailyBackup(dir: string): { file: string; date: string; at: Date; bytes: number } | null {
  let names: string[];
  try {
    names = fs.readdirSync(backupsDir(dir)).filter((f) => DAILY.test(f)).sort();
  } catch {
    return null;
  }
  const file = names.at(-1);
  if (!file) return null;
  try {
    const st = fs.statSync(path.join(backupsDir(dir), file));
    return { file, date: file.match(DAILY)![1], at: st.mtime, bytes: st.size };
  } catch {
    return null;
  }
}

export async function getLastBackup() {
  await connection();
  const dir = currentDataDir();
  return dir ? latestDailyBackup(dir) : null;
}

const AGE_UNITS = {
  en: { s: "s", m: "m", h: "h", d: "d" },
  id: { s: " dtk", m: " mnt", h: " j", d: " hr" },
};

/** "3s", "4m", "2h 10m", "3d" (Indonesian: "3 dtk", "2 j 10 mnt"): for ages and durations on the Health page. */
export function formatAge(ms: number, lang?: string | null) {
  const u = AGE_UNITS[uiLang(lang)];
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}${u.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${u.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}${u.h} ${m % 60}${u.m}` : `${h}${u.h}`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}${u.d} ${h % 24}${u.h}` : `${d}${u.d}`;
}
