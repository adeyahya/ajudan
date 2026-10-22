/**
 * A teammate's memory.md is read whole at the start of every run and appended to at
 * the end, so it only grows. Past this size the worker has the fast model rewrite it
 * into fixed sections (worker/handlers/memory.ts); these helpers decide when, and
 * whether a rewrite is safe to keep.
 */

export const MEMORY_CONSOLIDATE_BYTES = 8 * 1024;
export const MEMORY_SECTIONS = ["Preferences", "Decisions", "Lessons", "Facts"] as const;

export function memoryNeedsConsolidation(bytes: number) {
  return bytes > MEMORY_CONSOLIDATE_BYTES;
}

/** The "# Name's memory (Title)" first line, kept at the top of the rewrite. */
export function memoryTitle(markdown: string) {
  const first = markdown.split(/\r?\n/).find((l) => l.trim());
  return first?.startsWith("# ") ? first.trim() : null;
}

/**
 * Why a rewritten memory can't replace the original, or null when it can: it must
 * keep the title, have all four sections, say something, and be smaller.
 */
export function rejectConsolidated(original: string, rewritten: string): string | null {
  const out = rewritten.trim();
  if (!out) return "empty";
  const title = memoryTitle(original);
  if (title && memoryTitle(out) !== title) return "title changed";
  const missing = MEMORY_SECTIONS.filter((s) => !new RegExp(`^##\\s+${s}\\b`, "m").test(out));
  if (missing.length) return `missing section(s): ${missing.join(", ")}`;
  const body = out.replace(/^#.*$/gm, "").trim();
  if (body.length < 40) return "too short";
  if (Buffer.byteLength(out) >= Buffer.byteLength(original.trim())) return "not smaller";
  return null;
}
