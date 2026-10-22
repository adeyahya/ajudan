"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { Badge, Button, Card, cn, Textarea } from "@/components/kit";
import type { ContextSection, ReaderMode } from "@/db/schema";
import { setReaderAction, testAskAction } from "../actions";
import { ModeSwitch } from "../workspace";

type Load = { id: string; label: string; mode: "always" | "fetched" | "memory" | "conversation"; chars: number; truncated: boolean; pageId: string | null };

const COLOR: Record<Load["mode"], string> = {
  always: "bg-primary",
  fetched: "bg-info",
  memory: "bg-violet-400",
  conversation: "bg-good",
};

/** How much of the run's context each piece took: a proportional bar, then the list. */
export function LoadBar({ loads, businessId }: { loads: Load[]; businessId: string }) {
  const t = useT();
  const total = loads.reduce((n, l) => n + l.chars, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-4 w-full overflow-hidden border-2 border-frame bg-background">
        {loads.map((l) => (
          <span key={l.id} className={cn(COLOR[l.mode], "h-full border-r border-frame/60 last:border-r-0")} style={{ width: `${(l.chars / total) * 100}%` }} title={`${l.label}: ${l.chars}`} />
        ))}
      </div>
      <ul className="space-y-1 text-sm">
        {loads.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0", COLOR[l.mode])} />
            {l.pageId ? (
              <Link href={`/b/${businessId}/context?page=${l.pageId}`} className="min-w-0 flex-1 truncate hover:text-primary">
                {l.label}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate">{l.label}</span>
            )}
            <span className="text-xs text-muted-foreground">{t(`context.readers.load.${l.mode}`)}</span>
            {l.truncated && <Badge tone="amber">{t("context.readers.truncated")}</Badge>}
            <span className="w-28 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{t("context.readers.chars", { count: l.chars.toLocaleString() })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every page with this teammate's Always / When needed / Never (the same setting as the page's panel). */
export function PageModes({ businessId, teammateId, pages }: { businessId: string; teammateId: string; pages: { id: string; title: string; section: ContextSection; mode: ReaderMode }[] }) {
  const t = useT();
  const [, start] = useTransition();
  return (
    <ul className="divide-y divide-border">
      {pages.map((p) => (
        <li key={p.id} className="flex items-center gap-2 py-1.5">
          <Link href={`/b/${businessId}/context?page=${p.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-primary">
            {p.title}
          </Link>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">{t(`context.section.${p.section}`)}</span>
          <ModeSwitch value={p.mode} onChange={(mode) => start(() => setReaderAction(businessId, p.id, teammateId, mode))} />
        </li>
      ))}
    </ul>
  );
}

type Ask = { id: string; question: string; answer: string | null; cited: string[]; status: "queued" | "done" | "failed" };

/** A dry run: the worker answers on the fast model from this teammate's context only. */
export function TestAsk({ businessId, mate, asks, pageIds }: { businessId: string; mate: { id: string; name: string }; asks: Ask[]; pageIds: Record<string, string> }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">{t("context.ask.title", { name: mate.name })}</h2>
      <p className="text-[11px] text-muted-foreground">{t("context.ask.help", { name: mate.name })}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            await testAskAction(businessId, mate.id, q);
            setQ("");
          });
        }}
      >
        <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} placeholder={t("context.ask.placeholder")} className="text-sm" />
        <Button size="sm" type="submit" disabled={pending || !q.trim()}>
          {t("context.ask.button")}
        </Button>
      </form>
      {asks.map((a) => (
        <div key={a.id} className="space-y-1 border-t border-border pt-2 text-sm">
          <p className="font-medium">{a.question}</p>
          {a.status === "queued" ? (
            <p className="text-xs italic text-muted-foreground">{t("context.ask.waiting")}</p>
          ) : a.status === "failed" ? (
            <p className="text-xs text-red-400">{t("context.ask.failed")}</p>
          ) : (
            <>
              <p className="whitespace-pre-line">{a.answer}</p>
              <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                {a.cited.length ? `${t("context.ask.cited")}:` : t("context.ask.noCited")}
                {a.cited.map((c) =>
                  pageIds[c.toLowerCase()] ? (
                    <Link key={c} href={`/b/${businessId}/context?page=${pageIds[c.toLowerCase()]}`} className="underline hover:text-foreground">
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
      ))}
    </Card>
  );
}
