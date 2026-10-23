"use client";

import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { Avatar, Badge, Button, cn } from "@/components/kit";
import { testAskAction } from "../actions";

type Load = { id: string; label: string; mode: "always" | "fetched" | "memory" | "conversation"; chars: number; truncated: boolean; pageId: string | null };

/** The four kinds of context: always blue, fetched green, memory purple, conversation gray. */
const COLOR: Record<Load["mode"], string> = {
  always: "bg-primary",
  fetched: "bg-success",
  memory: "bg-tag-purple-fg/55",
  conversation: "bg-placeholder",
};
const MODES: Load["mode"][] = ["always", "fetched", "memory", "conversation"];

/** How much of the run's context each piece took: a 6px stacked bar with a legend, then the list. */
export function LoadBar({ loads, businessId }: { loads: Load[]; businessId: string }) {
  const t = useT();
  const total = loads.reduce((n, l) => n + l.chars, 0) || 1;
  const present = MODES.filter((m) => loads.some((l) => l.mode === m));
  return (
    <div>
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-secondary" role="img" aria-label={t("context.readers.barLabel")}>
        {loads.map((l) => (
          <span key={l.id} className={cn(COLOR[l.mode], "h-full")} style={{ width: `${(l.chars / total) * 100}%` }} title={`${l.label}: ${l.chars.toLocaleString()}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {present.map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", COLOR[m])} aria-hidden />
            {t(`context.readers.load.${m}`)}
          </span>
        ))}
      </div>
      <ul className="mt-4">
        {loads.map((l) => (
          <li key={l.id} className="flex h-8 items-center gap-2 border-b border-border/70 text-[13px] last:border-b-0">
            <span className={cn("size-2 shrink-0 rounded-full", COLOR[l.mode])} aria-hidden />
            {l.pageId ? (
              <Link href={`/b/${businessId}/context?page=${l.pageId}`} className="min-w-0 flex-1 truncate hover:underline">
                {l.label}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
            )}
            <span className="hidden text-xs text-tertiary sm:inline">{t(`context.readers.load.${l.mode}`)}</span>
            {l.truncated && <Badge tone="yellow">{t("context.readers.truncated")}</Badge>}
            <span className="w-24 shrink-0 text-right text-xs text-tertiary tabular-nums">{t("context.readers.chars", { count: l.chars.toLocaleString() })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Ask = { id: string; question: string; answer: string | null; cited: string[]; status: "queued" | "done" | "failed" };

/** A dry run: the worker answers on the fast model from this teammate's context only. */
export function TestAsk({ businessId, mate, asks, pageIds }: { businessId: string; mate: { id: string; name: string; color: string }; asks: Ask[]; pageIds: Record<string, string> }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  return (
    <section>
      <h2 className="text-base leading-6 font-semibold">{t("context.ask.title", { name: mate.name })}</h2>
      <p className="mt-0.5 mb-3 text-[13px] leading-[18px] text-muted-foreground">{t("context.ask.help", { name: mate.name })}</p>
      <form
        className="rounded-lg border border-input bg-background transition-[border-color,box-shadow] duration-100 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim()) return;
          start(async () => {
            await testAskAction(businessId, mate.id, q);
            setQ("");
          });
        }}
      >
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          placeholder={t("context.ask.placeholder")}
          aria-label={t("context.ask.title", { name: mate.name })}
          className="block min-h-[44px] w-full resize-none bg-transparent px-3 pt-2.5 text-sm leading-[22px] outline-none placeholder:text-placeholder"
        />
        <div className="flex justify-end px-2 pb-2">
          <Button type="submit" size="icon-sm" loading={pending} disabled={!q.trim()} aria-label={t("context.ask.button")}>
            <ArrowUp />
          </Button>
        </div>
      </form>
      <div className="mt-4 space-y-4">
        {asks.map((a) => (
          <div key={a.id} className="space-y-2">
            <p className="ml-auto w-fit max-w-[90%] rounded-lg bg-secondary px-3 py-2 text-sm leading-[22px]">{a.question}</p>
            <div className="grid grid-cols-[20px_1fr] gap-2.5">
              <Avatar seed={mate.id} name={mate.name} color={mate.color} size={20} />
              <div className="min-w-0 text-sm leading-[22px]">
                {a.status === "queued" ? (
                  <p className="text-[13px] text-muted-foreground">{t("context.ask.waiting")}</p>
                ) : a.status === "failed" ? (
                  <p className="text-[13px] text-destructive">{t("context.ask.failed")}</p>
                ) : (
                  <>
                    <p className="whitespace-pre-line">{a.answer}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-tertiary">
                      {a.cited.length ? `${t("context.ask.cited")}:` : t("context.ask.noCited")}
                      {a.cited.map((c) =>
                        pageIds[c.toLowerCase()] ? (
                          <Link key={c} href={`/b/${businessId}/context?page=${pageIds[c.toLowerCase()]}`} className="rounded-sm bg-hover px-1 text-foreground hover:bg-hover-strong">
                            {c}
                          </Link>
                        ) : (
                          <span key={c}>{c}</span>
                        ),
                      )}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
