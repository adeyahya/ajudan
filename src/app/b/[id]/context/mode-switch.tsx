"use client";

import { useT } from "@/components/i18n";
import { cn } from "@/components/kit";
import type { ReaderMode } from "@/db/schema";

const MODES: ReaderMode[] = ["always", "when_needed", "never"];

/**
 * How a page reaches a teammate: Always (in its prompt) / When needed / Never. A
 * segmented control (radio group: ←→ move between options).
 */
export function ModeSwitch({ value, onChange, label, className }: { value: ReaderMode; onChange: (m: ReaderMode) => void; label?: string; className?: string }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex shrink-0 rounded-md bg-secondary p-0.5", className)}>
      {MODES.map((m, i) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={m === value}
          tabIndex={m === value ? 0 : -1}
          onClick={() => m !== value && onChange(m)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const next = MODES[(i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length];
            onChange(next);
            (e.currentTarget.parentElement?.children[MODES.indexOf(next)] as HTMLElement | undefined)?.focus();
          }}
          className={cn(
            "h-6 rounded-sm px-2 text-xs leading-4 font-medium whitespace-nowrap transition-colors duration-100",
            m === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`context.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}
