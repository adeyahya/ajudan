import { describe, expect, it } from "vitest";
import {
  cleanQueueStreak,
  computeProgress,
  levelFor,
  levelThreshold,
  levelUps,
  trustByTeammate,
  trustScore,
  XP,
  xpItems,
  type ProgressApproval,
  type ProgressDeliverable,
  type ProgressTask,
} from "@/lib/progress";

const at = (s: string) => new Date(s);
// A fixed day key (UTC) so the tests don't depend on the machine's timezone.
const utcDay = (d: Date | number) => new Date(d).toISOString().slice(0, 10);

const task = (p: Partial<ProgressTask> = {}): ProgressTask => ({
  teammateId: "a",
  status: "done",
  createdBy: "user",
  createdAt: at("2026-10-01T08:00:00Z"),
  finishedAt: at("2026-10-01T09:00:00Z"),
  ...p,
});
const deliv = (p: Partial<ProgressDeliverable> = {}): ProgressDeliverable => ({
  teammateId: "a",
  status: "approved",
  revisions: 0,
  createdAt: at("2026-10-01T10:00:00Z"),
  ...p,
});
const appr = (p: Partial<ProgressApproval> = {}): ProgressApproval => ({
  teammateId: "a",
  status: "approved",
  createdAt: at("2026-10-01T08:00:00Z"),
  decidedAt: at("2026-10-01T08:30:00Z"),
  ...p,
});

describe("xp", () => {
  it("counts real outcomes only", () => {
    const items = xpItems({
      tasks: [
        task(),
        task({ createdBy: "system:reply" }),
        task({ createdBy: "system:report" }),
        task({ createdBy: "system:decision" }),
        task({ createdBy: "system:results" }),
        task({ status: "failed" }),
        task({ status: "running", finishedAt: null }),
      ],
      deliverables: [deliv(), deliv({ status: "ready_to_post" }), deliv({ status: "published" }), deliv({ status: "draft" }), deliv({ status: "rejected" })],
      approvals: [appr(), appr({ status: "rejected" }), appr({ status: "pending", decidedAt: null })],
    });
    const total = items.reduce((s, i) => s + i.xp, 0);
    expect(total).toBe(XP.task + XP.reply + XP.deliverable * 2 + (XP.deliverable + XP.posted) + XP.approval);
    // Oldest first.
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort((a, b) => a - b));
  });
});

describe("levels", () => {
  it("uses 50·L·(L−1) for the team and half for a teammate", () => {
    expect([1, 2, 3, 4, 5].map((l) => levelThreshold(l))).toEqual([0, 100, 300, 600, 1000]);
    expect([1, 2, 3, 4].map((l) => levelThreshold(l, 0.5))).toEqual([0, 50, 150, 300]);
  });
  it("reports progress through the current level", () => {
    expect(levelFor(0)).toEqual({ level: 1, xp: 0, floor: 0, next: 100, pct: 0 });
    expect(levelFor(99).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    const l = levelFor(450);
    expect(l.level).toBe(3);
    expect(l.pct).toBeCloseTo(0.5);
    expect(levelFor(60, 0.5).level).toBe(2);
  });
  it("replays outcomes into level-ups with the moment each was reached", () => {
    const items = [
      { teammateId: "a", xp: 40, at: 1 },
      { teammateId: "a", xp: 20, at: 2 }, // a reaches 60 → teammate level 2
      { teammateId: "b", xp: 40, at: 3 }, // team 100 → level 2
      { teammateId: null, xp: 250, at: 4 }, // team 350 → level 3
    ];
    expect(levelUps(items)).toEqual([
      { teammateId: "a", level: 2, at: 2 },
      { teammateId: null, level: 2, at: 3 },
      { teammateId: null, level: 3, at: 4 },
    ]);
  });
  it("records every level a big outcome jumps over", () => {
    expect(levelUps([{ teammateId: null, xp: 700, at: 5 }]).map((u) => u.level)).toEqual([2, 3, 4]);
  });
});

describe("trust", () => {
  it("starts at 3 and needs a steady record to reach 5", () => {
    expect(trustScore(0, 0).score).toBe(3);
    expect(trustScore(1, 0).score).toBe(4);
    expect(trustScore(5, 0).score).toBe(4);
    expect(trustScore(6, 0).score).toBe(5);
    expect(trustScore(0, 1).score).toBe(2);
    expect(trustScore(0, 8).score).toBe(1);
    expect(trustScore(4, 4).score).toBe(3);
  });
  it("counts work taken as it was against work sent back or revised", () => {
    const t = trustByTeammate({
      deliverables: [
        deliv(),
        deliv({ status: "published" }),
        deliv({ status: "approved", revisions: 1 }),
        deliv({ status: "rejected" }),
        deliv({ status: "draft" }), // not judged yet
        deliv({ teammateId: null }),
      ],
      approvals: [appr(), appr({ status: "rejected" }), appr({ status: "superseded" }), appr({ teammateId: "b" })],
    });
    expect(t.get("a")).toMatchObject({ good: 3, changes: 3 });
    expect(t.get("b")).toMatchObject({ good: 1, changes: 0, score: 4 });
  });
});

describe("clean queue streak", () => {
  const now = at("2026-10-05T15:00:00Z");
  const sameDay = (day: string) => appr({ createdAt: at(`${day}T08:00:00Z`), decidedAt: at(`${day}T20:00:00Z`) });

  it("counts days in a row the queue was cleared the same day, skipping days without approvals", () => {
    const s = cleanQueueStreak([sameDay("2026-10-01"), sameDay("2026-10-03"), sameDay("2026-10-04"), sameDay("2026-10-05")], now, utcDay);
    expect(s).toEqual({ current: 4, best: 4, today: "clear", waitingToday: 0 });
  });

  it("breaks on a day decided late or left pending", () => {
    const late = appr({ createdAt: at("2026-10-02T08:00:00Z"), decidedAt: at("2026-10-03T08:00:00Z") });
    expect(cleanQueueStreak([sameDay("2026-10-01"), late, sameDay("2026-10-04")], now, utcDay)).toMatchObject({ current: 1, best: 1 });
    const stale = appr({ status: "pending", createdAt: at("2026-10-03T08:00:00Z"), decidedAt: null });
    expect(cleanQueueStreak([sameDay("2026-10-01"), sameDay("2026-10-02"), stale], now, utcDay)).toMatchObject({ current: 0, best: 2 });
  });

  it("doesn't break while today is still going", () => {
    const waiting = appr({ status: "pending", createdAt: at("2026-10-05T09:00:00Z"), decidedAt: null });
    expect(cleanQueueStreak([sameDay("2026-10-03"), sameDay("2026-10-04"), waiting], now, utcDay)).toEqual({
      current: 2,
      best: 2,
      today: "waiting",
      waitingToday: 1,
    });
  });

  it("ignores superseded and cancelled requests", () => {
    const gone = appr({ status: "cancelled", createdAt: at("2026-10-04T08:00:00Z"), decidedAt: null });
    expect(cleanQueueStreak([sameDay("2026-10-03"), gone], now, utcDay)).toEqual({ current: 1, best: 1, today: "none", waitingToday: 0 });
  });
});

describe("computeProgress", () => {
  it("gives every teammate a level and trust, even with no record", () => {
    const p = computeProgress({ tasks: [task()], deliverables: [], approvals: [], teammateIds: ["a", "z"] }, at("2026-10-05T00:00:00Z"), utcDay);
    expect(p.team.xp).toBe(XP.task);
    expect(p.mates.a.level.xp).toBe(XP.task);
    expect(p.mates.z).toEqual({ level: levelFor(0, 0.5), trust: trustScore(0, 0) });
    expect(p.levelUps).toEqual([]);
  });
});
