/**
 * Team progress for the chat home (roadmap G1): XP, levels, trust and the clean-queue
 * streak, all derived from rows the app already keeps (tasks, deliverables, approvals).
 * Pure: the loader (getProgress in src/lib/data.ts) reads the rows and passes them in.
 *
 * XP (only real outcomes earn it; nothing is ever taken away):
 *   - a finished task (status done) ............................ 10 XP
 *     (the manager's own report / decision / results follow-ups don't count: they
 *     restate work already counted)
 *   - a WhatsApp chat answered (a done "system:reply" task) .... 15 XP
 *   - a deliverable the owner accepted (approved / ready to post) 20 XP
 *   - ...and posted (published) ................................ +20 XP (40 in all)
 *   - an approval the owner said yes to ......................... 5 XP
 * Owner replies on the Customer Desk are the owner's own shift score (src/lib/desk.ts),
 * not team XP.
 *
 * Levels: reaching level L takes 50·L·(L−1) XP for the team (100, 300, 600, 1000, …) and
 * half that for one teammate (50, 150, 300, 500, …).
 *
 * Trust (1–5, display only): the share of a teammate's work the owner took as it was.
 * Good = a deliverable accepted with no revisions, or an approved request. Needs work = a
 * deliverable sent back or revised, or a rejected request. Smoothed with one of each up
 * front, so a new teammate starts at 3, one verdict moves it one step, and 5 takes six
 * good pieces in a row:
 *   rate = (good + 1) / (good + changes + 2);  trust = round(1 + rate · 4)
 *
 * Streak: days in a row on which the owner decided every approval the same day it was
 * asked for. Days with no approvals are skipped (they neither count nor break it);
 * superseded and cancelled requests are ignored. Today counts once it's clear and never
 * breaks the streak while it's still going.
 */

export const XP = {
  task: 10,
  reply: 15,
  deliverable: 20,
  posted: 20,
  approval: 5,
} as const;

/** Task authors whose tasks are follow-ups, not outcomes (src/lib/manager.ts). */
const FOLLOW_UPS = new Set(["system:report", "system:decision", "system:results"]);
/** Written by worker/replies.ts on the tasks that answer a WhatsApp chat. */
export const REPLY_TASK = "system:reply";

export type ProgressTask = { teammateId: string; status: string; createdBy: string; finishedAt: Date | null; createdAt: Date };
export type ProgressDeliverable = { teammateId: string | null; status: string; revisions: number; createdAt: Date };
export type ProgressApproval = { teammateId: string; status: string; createdAt: Date; decidedAt: Date | null };

export type XpItem = { teammateId: string | null; xp: number; at: number };

/** Every XP-earning outcome, oldest first. */
export function xpItems(p: { tasks: ProgressTask[]; deliverables: ProgressDeliverable[]; approvals: ProgressApproval[] }): XpItem[] {
  const items: XpItem[] = [];
  for (const t of p.tasks) {
    if (t.status !== "done" || FOLLOW_UPS.has(t.createdBy)) continue;
    items.push({ teammateId: t.teammateId, xp: t.createdBy === REPLY_TASK ? XP.reply : XP.task, at: (t.finishedAt ?? t.createdAt).getTime() });
  }
  for (const d of p.deliverables) {
    const accepted = d.status === "approved" || d.status === "ready_to_post" || d.status === "published";
    if (!accepted) continue;
    items.push({ teammateId: d.teammateId, xp: XP.deliverable + (d.status === "published" ? XP.posted : 0), at: d.createdAt.getTime() });
  }
  for (const a of p.approvals) {
    if (a.status !== "approved") continue;
    items.push({ teammateId: a.teammateId, xp: XP.approval, at: (a.decidedAt ?? a.createdAt).getTime() });
  }
  return items.sort((a, b) => a.at - b.at);
}

/** XP needed to reach `level` (level 1 needs 0). `scale` 1 for the team, 0.5 for one teammate. */
export function levelThreshold(level: number, scale = 1) {
  return Math.round(50 * scale * level * (level - 1));
}

export type LevelInfo = {
  level: number;
  xp: number;
  /** XP at the start of this level and needed for the next. */
  floor: number;
  next: number;
  /** 0..1 progress through this level. */
  pct: number;
};

export function levelFor(xp: number, scale = 1): LevelInfo {
  let level = 1;
  while (xp >= levelThreshold(level + 1, scale)) level++;
  const floor = levelThreshold(level, scale);
  const next = levelThreshold(level + 1, scale);
  return { level, xp, floor, next, pct: next > floor ? (xp - floor) / (next - floor) : 1 };
}

export type LevelUp = { teammateId: string | null; level: number; at: number };

/**
 * When each level was reached, for the team (teammateId null) and for each teammate,
 * oldest first. Replaying the timestamped outcomes means level-ups need no table: the
 * chat shows the ones newer than what this viewer last saw.
 */
export function levelUps(items: XpItem[], teamScale = 1, mateScale = 0.5): LevelUp[] {
  const ups: LevelUp[] = [];
  let team = 0;
  const mates = new Map<string, number>();
  for (const it of items) {
    const before = levelFor(team, teamScale).level;
    team += it.xp;
    for (let l = before + 1; l <= levelFor(team, teamScale).level; l++) ups.push({ teammateId: null, level: l, at: it.at });
    if (it.teammateId) {
      const prev = mates.get(it.teammateId) ?? 0;
      const now = prev + it.xp;
      mates.set(it.teammateId, now);
      for (let l = levelFor(prev, mateScale).level + 1; l <= levelFor(now, mateScale).level; l++) ups.push({ teammateId: it.teammateId, level: l, at: it.at });
    }
  }
  return ups;
}

export type Trust = { score: number; good: number; changes: number };

export function trustScore(good: number, changes: number): Trust {
  const rate = (good + 1) / (good + changes + 2);
  return { score: Math.min(5, Math.max(1, Math.round(1 + rate * 4))), good, changes };
}

/** Each teammate's trust from their deliverables and approvals (teammates with no record start at 3). */
export function trustByTeammate(p: { deliverables: ProgressDeliverable[]; approvals: ProgressApproval[] }): Map<string, Trust> {
  const tally = new Map<string, { good: number; changes: number }>();
  const add = (id: string | null, good: boolean) => {
    if (!id) return;
    const t = tally.get(id) ?? { good: 0, changes: 0 };
    if (good) t.good++;
    else t.changes++;
    tally.set(id, t);
  };
  for (const d of p.deliverables) {
    const accepted = d.status === "approved" || d.status === "ready_to_post" || d.status === "published";
    if (d.status === "rejected" || (accepted && d.revisions > 0) || (d.status === "draft" && d.revisions > 0)) add(d.teammateId, false);
    else if (accepted) add(d.teammateId, true);
  }
  for (const a of p.approvals) {
    if (a.status === "approved") add(a.teammateId, true);
    else if (a.status === "rejected") add(a.teammateId, false);
  }
  return new Map([...tally].map(([id, t]) => [id, trustScore(t.good, t.changes)]));
}

export type Streak = {
  /** Days in a row, ending today or on the last day with approvals. */
  current: number;
  best: number;
  /** Today: "clear" (all decided), "waiting" (some still pending) or "none" (nothing asked). */
  today: "clear" | "waiting" | "none";
  /** Approvals asked today that still wait. */
  waitingToday: number;
};

/** Local calendar day, "YYYY-MM-DD", in the timezone of the process (the owner's machine). */
export function localDay(d: Date | number) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export function cleanQueueStreak(approvals: ProgressApproval[], now: Date, dayKey: (d: Date | number) => string = localDay): Streak {
  const today = dayKey(now);
  // Per day the approvals were asked: did each get decided that same day?
  const days = new Map<string, { clean: boolean; pending: number }>();
  for (const a of approvals) {
    if (a.status === "superseded" || a.status === "cancelled") continue;
    const day = dayKey(a.createdAt);
    const d = days.get(day) ?? { clean: true, pending: 0 };
    if (a.status === "pending") {
      d.pending++;
      if (day !== today) d.clean = false;
    } else if (!a.decidedAt || dayKey(a.decidedAt) !== day) {
      d.clean = false;
    }
    days.set(day, d);
  }
  const order = [...days.keys()].sort();
  let best = 0;
  let run = 0;
  for (const day of order) {
    const d = days.get(day)!;
    // Today, still going: neither counts nor breaks.
    if (day === today && d.pending > 0) continue;
    run = d.clean ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const t = days.get(today);
  return {
    current: run,
    best,
    today: !t ? "none" : t.pending > 0 ? "waiting" : "clear",
    waitingToday: t?.pending ?? 0,
  };
}

export type TeammateProgress = { level: LevelInfo; trust: Trust };

export type Progress = {
  team: LevelInfo;
  mates: Record<string, TeammateProgress>;
  streak: Streak;
  /** The latest level-ups (team and teammates), newest first. */
  levelUps: LevelUp[];
};

export function computeProgress(
  p: { tasks: ProgressTask[]; deliverables: ProgressDeliverable[]; approvals: ProgressApproval[]; teammateIds: string[] },
  now: Date,
  dayKey?: (d: Date | number) => string,
): Progress {
  const items = xpItems(p);
  const teamXp = items.reduce((s, i) => s + i.xp, 0);
  const mateXp = new Map<string, number>();
  for (const i of items) if (i.teammateId) mateXp.set(i.teammateId, (mateXp.get(i.teammateId) ?? 0) + i.xp);
  const trust = trustByTeammate(p);
  const mates: Record<string, TeammateProgress> = {};
  for (const id of p.teammateIds) mates[id] = { level: levelFor(mateXp.get(id) ?? 0, 0.5), trust: trust.get(id) ?? trustScore(0, 0) };
  return {
    team: levelFor(teamXp),
    mates,
    streak: cleanQueueStreak(p.approvals, now, dayKey),
    levelUps: levelUps(items).reverse().slice(0, 12),
  };
}
