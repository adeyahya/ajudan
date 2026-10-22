"use client";

import { useT } from "@/components/i18n";
import { Avatar } from "@/components/kit";
import { useStored } from "./use-stored";

export type LevelUpCard = { key: string; at: number; level: number; mate?: { id: string; name: string; color: string } };

/** A first-time viewer sees level-ups from the last few days, not the whole history. */
const FIRST_LOOK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Level-up moments in the conversation: small system cards for the levels reached since
 * this viewer last looked (src/lib/progress.ts replays them from real outcomes, so nothing
 * is stored but the viewer's "seen up to" time, in localStorage).
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
    <div role="status" className="flex shrink-0 flex-col gap-1.5">
      {fresh.map((u) => (
        <div
          key={u.key}
          className="mx-auto flex w-full max-w-xl animate-in fade-in slide-in-from-top-1 items-center gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 duration-500"
        >
          {u.mate ? (
            <Avatar seed={u.mate.id} name={u.mate.name} color={u.mate.color} size={28} />
          ) : (
            <span aria-hidden className="font-pixel flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground tabular-nums">
              {u.level}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-pixel text-sm text-primary">
              {u.mate ? t("chathome.levelUpMate", { name: u.mate.name, level: u.level }) : t("chathome.levelUpTeam", { level: u.level })}
            </p>
            <p className="truncate text-xs text-muted-foreground">{t("chathome.levelUpBody")}</p>
          </div>
          <button type="button" onClick={dismiss} className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {t("chathome.dismiss")}
          </button>
        </div>
      ))}
    </div>
  );
}
