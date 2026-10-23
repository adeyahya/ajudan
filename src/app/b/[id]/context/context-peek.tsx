"use client";

import { BookmarkPlus, ChartColumn, Users } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT, useTn } from "@/components/i18n";
import { Avatar, Badge, Button, cn, CountPill, EmptyState, Textarea } from "@/components/kit";
import { dateLocale } from "@/lib/i18n";
import { decideSuggestionAction, setReaderAction } from "./actions";
import { ModeSwitch } from "./mode-switch";
import type { Mate, ReaderView, SuggestionView, UsageView } from "./types";

/**
 * The page's side peek (opened from the top bar): what the team suggests for this page,
 * who reads it and how, and how often it was read this week. `tab` lives in the URL
 * (?peek=suggestions|readers|usage) so a reload keeps it.
 */

export type PeekTab = "suggestions" | "readers" | "usage";

export function PagePeekBody({
  tab,
  onTab,
  businessId,
  pageId,
  isPage,
  suggestions,
  otherPending,
  mates,
  readers,
  usage,
}: {
  tab: PeekTab;
  onTab: (t: PeekTab) => void;
  businessId: string;
  pageId: string;
  isPage: boolean;
  suggestions: SuggestionView[];
  otherPending: { pageId: string; title: string; count: number }[];
  mates: Mate[];
  readers: ReaderView[];
  usage: UsageView;
}) {
  const t = useT();
  const tabs: { key: PeekTab; label: string; count?: number }[] = [
    { key: "suggestions", label: t("context.peek.tabSuggestions"), count: suggestions.length },
    { key: "readers", label: t("context.peek.tabReaders") },
    { key: "usage", label: t("context.peek.tabUsage") },
  ];
  return (
    <div>
      <div role="tablist" className="-mt-1 mb-5 flex gap-4 border-b border-border">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => onTab(x.key)}
            className={cn(
              "relative -mb-px inline-flex h-8 items-center gap-1.5 text-[13px] leading-[18px] font-medium transition-colors duration-100",
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground",
              tab === x.key ? "text-foreground after:opacity-100" : "text-muted-foreground after:opacity-0 hover:text-foreground",
            )}
          >
            {x.label}
            {!!x.count && <CountPill count={x.count} className="bg-primary text-primary-foreground" />}
          </button>
        ))}
      </div>
      {tab === "suggestions" && <Suggestions businessId={businessId} suggestions={suggestions} mates={mates} otherPending={otherPending} />}
      {tab === "readers" && <Readers businessId={businessId} pageId={pageId} mates={mates} readers={readers} isPage={isPage} />}
      {tab === "usage" && <Usage usage={usage} mates={mates} />}
    </div>
  );
}

function Suggestions({ businessId, suggestions, mates, otherPending }: { businessId: string; suggestions: SuggestionView[]; mates: Mate[]; otherPending: { pageId: string; title: string; count: number }[] }) {
  const t = useT();
  const [shown, hide] = useOptimistic(suggestions, (list, id: string) => list.filter((s) => s.id !== id));
  return (
    <div className="space-y-6">
      {shown.length === 0 ? (
        <EmptyState compact icon={<BookmarkPlus />} title={t("context.panel.noSuggestionsTitle")} body={t("context.panel.noSuggestions")} />
      ) : (
        shown.map((s) => <SuggestionItem key={s.id} businessId={businessId} s={s} mate={mates.find((m) => m.id === s.authorId)} onDecided={hide} />)
      )}
      {otherPending.length > 0 && (
        <div className="border-t border-border pt-4">
          <p className="pb-1.5 text-xs text-tertiary">{t("context.allSuggestions")}</p>
          <ul>
            {otherPending.map((o) => (
              <li key={o.pageId}>
                <Link
                  href={`/b/${businessId}/context?page=${o.pageId}&peek=suggestions`}
                  className="-mx-2 flex h-7 items-center justify-between gap-2 rounded-md px-2 text-[13px] transition-colors duration-100 hover:bg-hover"
                >
                  <span className="truncate">{o.title}</span>
                  <CountPill count={o.count} className="bg-primary text-primary-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A suggestion as insertions and deletions. Readable on white: added lines on the green
 * tag background with its dark green text, removed lines on the red one, struck through
 * (both well above 4.5:1); unchanged lines in 75% ink.
 */
export function SuggestionDiff({ s }: { s: SuggestionView }) {
  const t = useT();
  return (
    <div className="max-h-72 overflow-auto rounded-md bg-muted py-1.5 font-mono text-xs leading-5" aria-label={t("context.suggest.diff")}>
      {s.diff.map((l, i) =>
        l.op === "skip" ? (
          <div key={i} className="px-3 text-tertiary select-none">
            ⋯
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              "px-3 break-words whitespace-pre-wrap",
              l.op === "add" && "bg-success-soft text-tag-green-fg",
              l.op === "del" && "bg-destructive-soft text-tag-red-fg line-through decoration-tag-red-fg/60",
              l.op === "same" && "text-foreground/75",
            )}
          >
            <span aria-hidden className="inline-block w-4 select-none">
              {l.op === "add" ? "+" : l.op === "del" ? "−" : ""}
            </span>
            <span className="sr-only">{l.op === "add" ? t("context.suggest.added") : l.op === "del" ? t("context.suggest.removed") : ""}</span>
            {l.text || " "}
          </div>
        ),
      )}
    </div>
  );
}

/** One suggestion with Accept / Edit / Reject. `showPage`: name the page it changes (the Organize list). */
export function SuggestionItem({ businessId, s, mate, onDecided, showPage = false }: { businessId: string; s: SuggestionView; mate?: Mate; onDecided: (id: string) => void; showPage?: boolean }) {
  const t = useT();
  const lang = useLang();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.body);
  const [pending, start] = useTransition();
  const decide = (accept: boolean, body?: string) =>
    start(async () => {
      onDecided(s.id);
      const r = await decideSuggestionAction(businessId, s.id, accept, body);
      if ("error" in r) toast.error(t("context.suggest.failed"));
      else toast(accept ? t("context.suggest.accepted") : t("context.suggest.rejected"));
    });
  return (
    <article className="space-y-2.5">
      <header className="flex items-center gap-2">
        {mate && <Avatar seed={mate.id} name={mate.name} color={mate.color} size={20} />}
        <span className="min-w-0 truncate text-[13px] leading-[18px] font-medium text-foreground">{t("context.suggest.from", { name: s.author ?? "?" })}</span>
        {s.fromChat && <Badge tone="purple">{t("context.suggest.manager")}</Badge>}
        <span className="ml-auto shrink-0 text-xs text-tertiary">{new Date(s.createdAt).toLocaleDateString(dateLocale(lang), { day: "numeric", month: "short" })}</span>
      </header>
      {s.kind === "new_page" && <p className="text-[13px] font-medium">{t("context.suggest.newPage", { title: s.title ?? "", section: s.section ? t(`context.section.${s.section}`) : "" })}</p>}
      {showPage && s.kind !== "new_page" && s.pageId && (
        <p className="text-[13px] font-medium">
          {t(s.kind === "delete" ? "context.suggest.removePage" : "context.suggest.onPage")}{" "}
          <Link href={`/b/${businessId}/context?page=${s.pageId}`} className="underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
            {s.pageTitle}
          </Link>
        </p>
      )}
      {!showPage && s.kind === "delete" && <p className="text-[13px] font-medium">{t("context.suggest.removeThis")}</p>}
      {s.kind === "replace" && s.title && <p className="text-[13px]">{t("context.suggest.rename", { title: s.title })}</p>}
      {s.kind === "replace" && s.section && <p className="text-[13px]">{t("context.suggest.move", { section: t(`context.section.${s.section}`) })}</p>}
      {s.reason && <p className="text-[13px] leading-[18px] text-foreground">{s.reason}</p>}
      {s.source && (
        <p className="text-xs text-muted-foreground">
          {t("context.suggest.source")}: {s.source}
        </p>
      )}
      {s.changedSince && <p className="rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-tag-yellow-fg">{t("context.suggest.changedSince")}</p>}
      {editing ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-mono text-xs" aria-label={t("context.edit")} />
      ) : (
        s.diff.some((l) => l.op === "add" || l.op === "del") && <SuggestionDiff s={s} />
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" loading={pending} onClick={() => decide(true, editing ? text : undefined)}>
          {t("context.accept")}
        </Button>
        {s.kind !== "delete" && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(!editing)}>
            {editing ? t("context.cancel") : t("context.edit")}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(false)}>
          {t("context.reject")}
        </Button>
      </div>
    </article>
  );
}

/** Who reads the page, and how: one row per teammate with the three-way switch. */
export function Readers({ businessId, pageId, mates, readers, isPage }: { businessId: string; pageId: string; mates: Mate[]; readers: ReaderView[]; isPage: boolean }) {
  const t = useT();
  const [modes, setMode] = useOptimistic(readers, (list, r: ReaderView) => list.map((x) => (x.teammateId === r.teammateId ? r : x)));
  const [, start] = useTransition();
  if (!mates.length) return <EmptyState compact icon={<Users />} title={t("context.notActive")} />;
  return (
    <div>
      <p className="mb-3 text-[13px] leading-[18px] text-muted-foreground">{isPage ? t("context.panel.readersHelp") : t("context.panel.readersHelpDb")}</p>
      <ul>
        {mates.map((m) => (
          <li key={m.id} className="flex min-h-10 items-center gap-2.5 border-b border-border/70 py-1.5 last:border-b-0">
            <Avatar seed={m.id} name={m.name} color={m.color} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-[18px] font-medium">{m.name}</span>
              <span className="block truncate text-xs text-tertiary">{m.title}</span>
            </span>
            <ModeSwitch
              label={m.name}
              value={modes.find((r) => r.teammateId === m.id)?.mode ?? "when_needed"}
              onChange={(mode) =>
                start(async () => {
                  setMode({ teammateId: m.id, mode });
                  await setReaderAction(businessId, pageId, m.id, mode);
                })
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Usage({ usage, mates }: { usage: UsageView; mates: Mate[] }) {
  const t = useT();
  const tn = useTn();
  if (usage.runs === 0) return <EmptyState compact icon={<ChartColumn />} title={t("context.usage.none")} body={t("context.usage.noneBody")} />;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-[22px]">
        <span className="font-semibold">{tn("context.usage.runs", usage.runs)}</span>
        {usage.fetched > 0 && <span className="text-muted-foreground"> · {t("context.usage.fetched", { count: usage.fetched })}</span>}
      </p>
      <ul className="space-y-2">
        {usage.byTeammate.map((u) => {
          const m = mates.find((x) => x.id === u.id);
          return (
            <li key={u.id} className="grid grid-cols-[20px_6rem_1fr_2rem] items-center gap-2 text-[13px]">
              {m ? <Avatar seed={m.id} name={m.name} color={m.color} size={20} /> : <span />}
              <span className="truncate">{m?.name ?? "?"}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(6, (u.count / usage.runs) * 100)}%` }} />
              </span>
              <span className="text-right text-xs text-tertiary tabular-nums">{u.count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
