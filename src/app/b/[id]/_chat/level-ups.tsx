"use client";

import { Sparkles } from "lucide-react";
import { useT } from "@/components/i18n";
import { useStored } from "./use-stored";

export type LevelUpCard = { key: string; at: number; level: number; mate?: { id: string; name: string; color: string } };

/** A first-time viewer sees level-ups from the last few days, not the whole history. */
const FIRST_LOOK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Level-up moments above the conversation: one centered 13px line per level reached since
 * this viewer last looked (src/lib/progress.ts replays them from real outcomes, so nothing
 * is stored but the viewer's "seen up to" time, in localStorage). Dismiss marks them seen.
 */
export function LevelUps({ businessId, ups, now }: { businessId: string; ups: LevelUpCard[]; now: number }) {
  const t = useT();
  // "ssr" until hydrated: what this viewer saw lives in their browser, so render nothing before.
  const [seenRaw, setSeen] = useStored(`ajudan:levelups-seen:${businessId}`, "", "ssr");
  const seen = Number(seenRaw) || now - FIRST_LOOK_MS;
  const fresh = ups.filter((u) => u.at > seen).slice(0, 2);
  if (seenRaw === "ssr" || !fresh.length) return null;
  const dismiss = () => setSeen(String(Math.max(...ups.map((u) => u.at), now)));
  return (
    <div role="status" className="flex shrink-0 flex-col items-center gap-0.5 px-4 py-1.5">
      {fresh.map((u, i) => (
        <p
          key={u.key}
          title={t("chathome.levelUpBody")}
          className="flex max-w-full animate-in items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground duration-300 fade-in-0 motion-reduce:animate-none"
        >
          <Sparkles aria-hidden className="size-3.5 shrink-0 text-primary" strokeWidth={1.75} />
          <span className="truncate">
            {u.mate ? t("chathome.levelUpMate", { name: u.mate.name, level: u.level }) : t("chathome.levelUpTeam", { level: u.level })}
          </span>
          {i === fresh.length - 1 && (
            <button
              type="button"
              onClick={dismiss}
              className="ml-1 shrink-0 rounded-sm px-1 text-xs text-tertiary transition-colors duration-100 hover:bg-hover hover:text-foreground"
            >
              {t("chathome.dismiss")}
            </button>
          )}
        </p>
      ))}
    </div>
  );
}
