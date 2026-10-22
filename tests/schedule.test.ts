import { describe, expect, it } from "vitest";
import { buildCron, describeCron, nextRunOf, parseCronPreset, validCron, type SchedulePreset } from "@/lib/onboarding/schedule";
import { formatScheduledInstructions } from "@/lib/schedule-context";
import { HEARTBEAT_STALE_MS, heartbeatAge, heartbeatFresh } from "@/lib/worker-heartbeat";
import { formatAge } from "@/lib/health";

describe("schedule picker presets", () => {
  const presets: SchedulePreset[] = [
    { mode: "daily", hour: 9, minute: 0 },
    { mode: "daily", hour: 0, minute: 30 },
    { mode: "weekdays", hour: 8, minute: 15 },
    { mode: "weekly", days: [1], hour: 9, minute: 0 },
    { mode: "weekly", days: [1, 3, 5], hour: 17, minute: 45 },
    { mode: "weekly", days: [6, 0], hour: 10, minute: 0 },
    { mode: "weekly", days: [0, 1, 2, 3, 4, 5, 6], hour: 7, minute: 0 },
  ];

  it("every picker output passes validCron and reads as plain words", () => {
    for (const p of presets) {
      const cron = buildCron(p)!;
      expect(validCron(cron)).toBe(cron);
      expect(describeCron(cron)).not.toBe(cron);
    }
  });

  it("builds the expected cron strings", () => {
    expect(buildCron({ mode: "daily", hour: 9, minute: 0 })).toBe("0 9 * * *");
    expect(buildCron({ mode: "weekdays", hour: 8, minute: 15 })).toBe("15 8 * * 1-5");
    expect(buildCron({ mode: "weekly", days: [5, 1, 3], hour: 17, minute: 45 })).toBe("45 17 * * 1,3,5");
    expect(buildCron({ mode: "weekly", days: [1, 2, 3, 4, 5], hour: 9, minute: 0 })).toBe("0 9 * * 1-5");
    expect(buildCron({ mode: "weekly", days: [0, 1, 2, 3, 4, 5, 6], hour: 9, minute: 0 })).toBe("0 9 * * *");
    expect(buildCron({ mode: "weekly", days: [], hour: 9, minute: 0 })).toBeNull();
    expect(buildCron({ mode: "custom", expr: "  0 */2 * * *  " })).toBe("0 */2 * * *");
    expect(buildCron({ mode: "custom", expr: " " })).toBeNull();
  });

  it("clamps out-of-range times", () => {
    expect(buildCron({ mode: "daily", hour: 25, minute: 99 })).toBe("59 23 * * *");
    expect(buildCron({ mode: "daily", hour: -1, minute: NaN })).toBe("0 0 * * *");
  });

  it("round-trips through parseCronPreset", () => {
    for (const p of presets) {
      const cron = buildCron(p)!;
      const back = parseCronPreset(cron)!;
      expect(buildCron(back)).toBe(cron);
    }
    expect(parseCronPreset("0 9 * * *")).toEqual({ mode: "daily", hour: 9, minute: 0 });
    expect(parseCronPreset("15 8 * * 1-5")).toEqual({ mode: "weekdays", hour: 8, minute: 15 });
    expect(parseCronPreset("0 9 * * 1,3")).toEqual({ mode: "weekly", days: [1, 3], hour: 9, minute: 0 });
    expect(parseCronPreset("0 9 * * 7")).toEqual({ mode: "weekly", days: [0], hour: 9, minute: 0 });
    expect(parseCronPreset("")).toBeNull();
  });

  it("falls back to custom for what the picker can't express", () => {
    expect(parseCronPreset("0 */2 * * *")).toEqual({ mode: "custom", expr: "0 */2 * * *" });
    expect(parseCronPreset("0 9 1 * *")).toEqual({ mode: "custom", expr: "0 9 1 * *" });
    expect(parseCronPreset("0 9 * * MON")).toEqual({ mode: "custom", expr: "0 9 * * MON" });
  });
});

describe("describeCron", () => {
  it("describes daily, weekdays, weekends, single and several days", () => {
    expect(describeCron(null)).toBe("No recurring work");
    expect(describeCron("0 9 * * *")).toBe("Every day at 09:00");
    expect(describeCron("30 8 * * 1-5")).toBe("Weekdays at 08:30");
    expect(describeCron("0 10 * * 6,0")).toBe("Weekends at 10:00");
    expect(describeCron("0 9 * * 1")).toBe("Every Monday at 09:00");
    expect(describeCron("0 9 * * 7")).toBe("Every Sunday at 09:00");
    expect(describeCron("45 17 * * 1,3,5")).toBe("Monday, Wednesday and Friday at 17:45");
    expect(describeCron("0 9 * * 1-3")).toBe("Monday, Tuesday and Wednesday at 09:00");
    expect(describeCron("0 9 * * 0,1,2,3,4,5,6")).toBe("Every day at 09:00");
  });

  it("leaves anything else as is", () => {
    expect(describeCron("0 */2 * * *")).toBe("0 */2 * * *");
    expect(describeCron("0 9 1 * *")).toBe("0 9 1 * *");
  });
});

describe("nextRunOf", () => {
  it("gives the next slot after a moment, and null for an invalid expression", () => {
    const from = new Date(2026, 9, 21, 10, 0); // Wednesday
    expect(nextRunOf("0 9 * * 1", from)?.getTime()).toBe(new Date(2026, 9, 26, 9, 0).getTime());
    expect(nextRunOf("not a cron", from)).toBeNull();
    expect(nextRunOf("", from)).toBeNull();
  });
});

describe("formatScheduledInstructions", () => {
  it("keeps the schedule prompt first and says it's the first run", () => {
    const text = formatScheduledInstructions("Plan this week's posts", { previous: null, deliverables: [], approvals: [], waiting: [] });
    expect(text.startsWith("Plan this week's posts\n\n## Since your last scheduled run")).toBe(true);
    expect(text).toContain("This is the first scheduled run.");
    expect(text).not.toContain("Still open");
  });

  it("summarises the previous run, the work since and what's open", () => {
    const text = formatScheduledInstructions("Weekly plan", {
      previous: { title: "Weekly plan", status: "done", finishedAt: new Date("2026-10-14T09:30:00Z"), result: `Wrote 3 posts.\n\n\nNext: carousel.${"x".repeat(1000)}` },
      deliverables: [
        { title: "Post A", kind: "social_post", status: "approved" },
        { title: "Post B", kind: "social_post", status: "rejected" },
        { title: "Post C", kind: "social_post", status: "draft" },
      ],
      approvals: [{ summary: "Send WhatsApp message to the supplier group" }],
      waiting: [{ title: "Ask Budi for footage", status: "waiting_human" }],
    });
    expect(text).toContain("### Previous scheduled run (2026-10-14): done");
    expect(text).toContain("Wrote 3 posts.\nNext: carousel.");
    expect(text).toContain("…"); // the long result is clipped
    expect(text.length).toBeLessThan(1400);
    expect(text).toContain("- Post A (social_post): approved by the owner");
    expect(text).toContain("- Post B (social_post): rejected by the owner");
    expect(text).toContain("- Post C (social_post): draft, not reviewed yet");
    expect(text).toContain("Waiting for the owner's approval: Send WhatsApp message to the supplier group");
    expect(text).toContain('"Ask Budi for footage" is waiting for a person\'s reply');
    expect(text).toContain("Don't redo or re-ask these");
  });

  it("caps long lists", () => {
    const deliverables = Array.from({ length: 14 }, (_, i) => ({ title: `Post ${i}`, kind: "social_post", status: "draft" }));
    const text = formatScheduledInstructions("Weekly plan", { previous: null, deliverables, approvals: [], waiting: [] });
    expect(text).toContain("- Post 9 (social_post)");
    expect(text).not.toContain("- Post 10 (social_post)");
    expect(text).toContain("…and 4 more on the Work page");
  });
});

describe("heartbeat freshness", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  const hb = (agoMs: number) => ({ pid: 1, startedAt: "x", at: new Date(now - agoMs).toISOString(), running: { owner: 0, team: 0 }, concurrency: { owner: 2, team: 2 } });

  it("is fresh within the stale window and stale after", () => {
    expect(heartbeatFresh(hb(0), now)).toBe(true);
    expect(heartbeatFresh(hb(HEARTBEAT_STALE_MS), now)).toBe(true);
    expect(heartbeatFresh(hb(HEARTBEAT_STALE_MS + 1), now)).toBe(false);
    expect(heartbeatFresh(null, now)).toBe(false);
    expect(heartbeatAge(hb(5000), now)).toBe(5000);
    expect(heartbeatAge({ ...hb(0), at: "garbage" }, now)).toBeNull();
    expect(heartbeatAge(null, now)).toBeNull();
  });
});

describe("formatAge", () => {
  it("picks the biggest useful unit", () => {
    expect(formatAge(0)).toBe("0s");
    expect(formatAge(42_000)).toBe("42s");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(2 * 3_600_000 + 10 * 60_000)).toBe("2h 10m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(3 * 86_400_000)).toBe("3d");
    expect(formatAge(26 * 3_600_000)).toBe("1d 2h");
  });
});
