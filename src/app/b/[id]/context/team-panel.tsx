"use client";

import Link from "next/link";
import { useLang, useT } from "@/components/i18n";
import { cn } from "@/components/kit";
import { dateLocale } from "@/lib/i18n";
import { Readers } from "./context-peek";
import type { HistoryItem, Mate, ReaderView, SizeView } from "./types";

/**
 * "How the team uses this page": who reads it and how (the three-way switch per
 * teammate), its size in a prompt, recent decided changes, and a way into the Team view.
 * Inline beside the page on wide screens, the peek's Team tab otherwise.
 */
export function TeamPanel({
  businessId,
  pageId,
  mates,
  readers,
  isPage,
  size,
  history,
}: {
  businessId: string;
  pageId: string;
  mates: Mate[];
  readers: ReaderView[];
  isPage: boolean;
  size: SizeView;
  history: HistoryItem[];
}) {
  const t = useT();
  const lang = useLang();
  const pct = Math.min(100, Math.round((size.chars / size.max) * 100));
  const cut = size.chars > size.max;
  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-2 text-[13px] leading-[18px] font-semibold">{t("context.team.who")}</h3>
        <Readers businessId={businessId} pageId={pageId} mates={mates} readers={readers} isPage={isPage} />
      </section>
      {isPage && (
        <section>
          <h3 className="mb-2 text-[13px] leading-[18px] font-semibold">{t("context.team.size")}</h3>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={t("context.team.sizeOf", { chars: size.chars.toLocaleString(dateLocale(lang)), max: size.max.toLocaleString(dateLocale(lang)) })}>
            <div className={cn("h-full rounded-full", cut ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <p className={cn("mt-1.5 text-xs", cut ? "text-warning" : "text-muted-foreground")}>
            {t(cut ? "context.team.sizeCut" : "context.team.sizeFits", { chars: size.chars.toLocaleString(dateLocale(lang)), max: size.max.toLocaleString(dateLocale(lang)) })}
          </p>
        </section>
      )}
      {history.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] leading-[18px] font-semibold">{t("context.team.history")}</h3>
          <ul className="space-y-1.5 text-[13px] text-muted-foreground">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {t(h.status === "accepted" ? "context.team.accepted" : "context.team.rejected", { name: h.author ?? t("context.by.system") })}
                </span>
                <span className="shrink-0 text-tertiary">{new Date(h.at).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Link href={`/b/${businessId}/context/readers`} className="inline-block text-[13px] text-primary hover:underline">
        {t("context.team.lens")}
      </Link>
    </div>
  );
}
