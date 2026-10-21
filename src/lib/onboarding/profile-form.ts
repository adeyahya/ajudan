import type { BusinessProfile } from "@/lib/types";

/** Helpers to round-trip a BusinessProfile through plain textareas. */

export const lines = (s: FormDataEntryValue | null) =>
  String(s ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export const joinLines = (items: string[]) => items.join("\n");

export function goalsToText(goals: BusinessProfile["goals"]) {
  return goals.map((g) => `${g.goal} | ${g.metric} | ${g.target}`).join("\n");
}

export function textToGoals(s: FormDataEntryValue | null): BusinessProfile["goals"] {
  return lines(s).map((l) => {
    const [goal = "", metric = "", target = ""] = l.split("|").map((p) => p.trim());
    return { goal, metric, target };
  });
}
