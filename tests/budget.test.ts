import { describe, expect, it } from "vitest";
import { overBudget, parseBudget, startOfDay, startOfWeek } from "@/lib/budget";
import { MIN_CRON_INTERVAL_MS, validCron } from "@/lib/onboarding/schedule";
import { MEMORY_CONSOLIDATE_BYTES, memoryNeedsConsolidation, memoryTitle, rejectConsolidated } from "@/lib/memory";

describe("budget helpers", () => {
  it("startOfDay and startOfWeek are local midnights", () => {
    const wed = new Date(2026, 9, 21, 15, 30); // Wednesday 21 Oct 2026
    expect(startOfDay(wed).getTime()).toBe(new Date(2026, 9, 21).getTime());
    expect(startOfWeek(wed).getTime()).toBe(new Date(2026, 9, 19).getTime()); // Monday
    const sun = new Date(2026, 9, 25, 9);
    expect(startOfWeek(sun).getTime()).toBe(new Date(2026, 9, 19).getTime());
    const mon = new Date(2026, 9, 19, 0, 1);
    expect(startOfWeek(mon).getTime()).toBe(new Date(2026, 9, 19).getTime());
  });

  it("overBudget compares spend to the cap; no cap means no limit", () => {
    expect(overBudget(19.99, 20)).toBe(false);
    expect(overBudget(20, 20)).toBe(true);
    expect(overBudget(1000, 0)).toBe(false);
  });

  it("parseBudget accepts dollar amounts, with 0 or blank meaning no limit", () => {
    expect(parseBudget("25")).toBe(25);
    expect(parseBudget("$12.5")).toBe(12.5);
    expect(parseBudget("0")).toBe(0);
    expect(parseBudget("-3")).toBeNull();
    expect(parseBudget("abc")).toBeNull();
    expect(parseBudget("")).toBe(0);
    expect(parseBudget("  ")).toBe(0);
    expect(parseBudget("99999")).toBe(1000);
  });
});

describe("validCron", () => {
  it("accepts schedules that run at most hourly", () => {
    expect(validCron("0 9 * * 1")).toBe("0 9 * * 1");
    expect(validCron(" 0 * * * * ")).toBe("0 * * * *");
    expect(validCron("30 8 * * 1-5")).toBe("30 8 * * 1-5");
  });

  it("rejects schedules that fire more than once an hour", () => {
    expect(MIN_CRON_INTERVAL_MS).toBe(3_600_000);
    expect(validCron("*/15 * * * *")).toBeNull();
    expect(validCron("0,30 * * * *")).toBeNull();
    expect(validCron("* * * * *")).toBeNull();
    // Twice at 9 (9:00 and 9:30) even though the rest of the day is quiet.
    expect(validCron("0,30 9 * * *")).toBeNull();
  });

  it("rejects nonsense and empties", () => {
    expect(validCron("")).toBeNull();
    expect(validCron(null)).toBeNull();
    expect(validCron("every monday")).toBeNull();
  });
});

describe("memory consolidation", () => {
  const original = `# Raka's memory (Copywriter)\n\n${"- The owner prefers short captions.\n".repeat(400)}`;
  const good = `# Raka's memory (Copywriter)\n\n## Preferences\n- The owner prefers short captions.\n\n## Decisions\n- Posting on Tuesdays.\n\n## Lessons\n- Hooks in the first line.\n\n## Facts\n- Shop is in Bandung.\n`;

  it("triggers past 8 KB", () => {
    expect(MEMORY_CONSOLIDATE_BYTES).toBe(8192);
    expect(memoryNeedsConsolidation(8192)).toBe(false);
    expect(memoryNeedsConsolidation(8193)).toBe(true);
    expect(Buffer.byteLength(original)).toBeGreaterThan(MEMORY_CONSOLIDATE_BYTES);
  });

  it("reads the title line", () => {
    expect(memoryTitle(original)).toBe("# Raka's memory (Copywriter)");
    expect(memoryTitle("no heading\n")).toBeNull();
  });

  it("accepts a smaller rewrite with the title and all four sections", () => {
    expect(rejectConsolidated(original, good)).toBeNull();
  });

  it("rejects rewrites that lose the title, a section, the content or don't shrink", () => {
    expect(rejectConsolidated(original, "")).toBe("empty");
    expect(rejectConsolidated(original, good.replace("# Raka's memory (Copywriter)", "# Notes"))).toBe("title changed");
    expect(rejectConsolidated(original, good.replace("## Lessons", "## Learnings"))).toBe("missing section(s): Lessons");
    expect(rejectConsolidated(original, "# Raka's memory (Copywriter)\n## Preferences\n## Decisions\n## Lessons\n## Facts\n")).toBe("too short");
    expect(rejectConsolidated(good, good)).toBe("not smaller");
  });
});
