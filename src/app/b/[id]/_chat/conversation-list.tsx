import { Headset } from "lucide-react";
import Link from "next/link";
import type { Teammate, TeammateState } from "@/db/schema";
import { Avatar } from "@/components/kit";
import { formatUsd } from "@/lib/budget";
import { t, tn, type MessageKey, type UiLang } from "@/lib/i18n";
import type { LevelInfo, Progress, Trust } from "@/lib/progress";
import { cn } from "@/lib/utils";

/** What the list needs; loaded once by the chat home (and the teammate pages). */
export type ConversationData = {
  businessId: string;
  lang: UiLang;
  teammates: Teammate[];
  managerId: string | null;
  pendingApprovals: number;
  deskChats: number;
  progress: Progress;
  spend: { today: number; week: number; cap: number; over: boolean };
};

const DOT: Record<TeammateState, string> = {
  idle: "bg-muted-foreground/40",
  working: "bg-good animate-pulse",
  waiting: "bg-warn",
  error: "bg-bad",
};

const STATE_KEY: Record<TeammateState, MessageKey> = {
  idle: "office.state.idle",
  working: "office.state.working",
  waiting: "office.state.waiting",
  error: "office.state.error",
};

function statusLine(m: Teammate, lang: UiLang) {
  if (m.kind === "human") return t(lang, "chathome.person");
  if (m.state === "working" || m.state === "error") return m.currentActivity || t(lang, STATE_KEY[m.state]);
  if (m.state === "waiting") return t(lang, "office.state.waiting");
  return t(lang, "chathome.ready");
}

function XpBar({ level, className }: { level: LevelInfo; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, level.pct)) * 100)}%` }}
      />
    </div>
  );
}

function TrustBar({ trust, lang }: { trust: Trust; lang: UiLang }) {
  return (
    <span
      role="img"
      aria-label={t(lang, "chathome.trust", { score: trust.score })}
      title={t(lang, "chathome.trustTitle", { score: trust.score, good: trust.good, changes: trust.changes })}
      className="inline-flex shrink-0 gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("h-1 w-2.5 rounded-full", i <= trust.score ? "bg-good" : "bg-muted")} />
      ))}
    </span>
  );
}

function LevelBadge({ level, lang }: { level: LevelInfo; lang: UiLang }) {
  return (
    <span
      title={t(lang, "chathome.levelTitle", { level: level.level, xp: level.xp })}
      className="font-pixel shrink-0 rounded-sm bg-secondary px-1 text-[10px] leading-4 text-secondary-foreground tabular-nums"
    >
      {t(lang, "chathome.level", { level: level.level })}
    </span>
  );
}

const row = "group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-200";
const rowState = (active: boolean) => (active ? "bg-secondary text-foreground shadow-[inset_3px_0_0_var(--primary)]" : "hover:bg-secondary/60");

/**
 * The chat home's left column: team level, the manager pinned on top with what needs
 * the owner, the Customer Desk, then each teammate with their live status, level and
 * trust, and the clean-queue streak at the bottom. Server-rendered; LiveRefresh in the
 * chat re-renders it on every worker event.
 */
export function ConversationList({ data, activeId, className }: { data: ConversationData; activeId: string | null; className?: string }) {
  const { businessId, lang, teammates, managerId, pendingApprovals, deskChats, progress, spend } = data;
  const base = `/b/${businessId}`;
  const manager = teammates.find((m) => m.id === managerId);
  const others = teammates.filter((m) => m.id !== managerId).sort((a, b) => Number(a.kind === "human") - Number(b.kind === "human"));
  const team = progress.team;
  const streak = progress.streak;

  return (
    <aside className={cn("min-h-0 flex-col gap-3", className)}>
      <div className="pixel-panel shrink-0 space-y-2 p-3" title={t(lang, "chathome.xpHint")}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-pixel text-sm text-primary">{t(lang, "chathome.teamLevel", { level: team.level })}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{t(lang, "chathome.xp", { xp: team.xp, next: team.next })}</span>
        </div>
        <XpBar level={team} />
        <p className="text-[11px] text-muted-foreground tabular-nums">{t(lang, "chathome.toNext", { count: team.next - team.xp, level: team.level + 1 })}</p>
      </div>

      <nav aria-label={t(lang, "chathome.conversations")} className="pixel-panel flex min-h-0 flex-1 flex-col p-1.5">
        <h2 className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t(lang, "chathome.conversations")}</h2>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {manager && (
            <Link href={base} aria-current={activeId === manager.id ? "page" : undefined} className={cn(row, rowState(activeId === manager.id))}>
              <span className="relative shrink-0">
                <Avatar seed={manager.id} name={manager.name} color={manager.color} size={36} />
                <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card", DOT[manager.state])} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{manager.name}</span>
                  <LevelBadge level={progress.mates[manager.id]?.level ?? team} lang={lang} />
                </span>
                <span className="block truncate text-xs text-muted-foreground">{statusLine(manager, lang)}</span>
              </span>
              {pendingApprovals > 0 ? (
                <span className="shrink-0 rounded-full bg-warn px-1.5 text-[11px] font-semibold leading-5 text-ink tabular-nums">
                  {tn(lang, "chathome.needsYou", pendingApprovals)}
                </span>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">{t(lang, "chathome.allClear")}</span>
              )}
            </Link>
          )}

          <Link href={`${base}/desk`} className={cn(row, rowState(false))}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info/20 text-info">
              <Headset aria-hidden className="size-4.5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t(lang, "chathome.customers")}</span>
              <span className="block truncate text-xs text-muted-foreground tabular-nums">
                {deskChats > 0 ? tn(lang, "chathome.customersSub", deskChats) : t(lang, "chathome.customersNone")}
              </span>
            </span>
          </Link>

          <div className="mx-2 my-1.5 border-t border-secondary" />

          {others.map((m) => {
            const p = progress.mates[m.id];
            const active = activeId === m.id;
            return (
              <Link key={m.id} href={`${base}/teammates/${m.id}`} aria-current={active ? "page" : undefined} className={cn(row, rowState(active))}>
                <span className="relative shrink-0">
                  <Avatar seed={m.id} name={m.name} color={m.color} size={32} />
                  {m.kind === "ai" && <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card", DOT[m.state])} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{m.name}</span>
                    {m.kind === "ai" && p && <LevelBadge level={p.level} lang={lang} />}
                  </span>
                  <span className={cn("block truncate text-xs", m.state === "working" ? "text-foreground/80 italic" : "text-muted-foreground")}>
                    {statusLine(m, lang)}
                  </span>
                </span>
                {m.kind === "ai" && p && <TrustBar trust={p.trust} lang={lang} />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="pixel-panel shrink-0 p-3" title={t(lang, "chathome.streakHint")}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">{t(lang, "chathome.streak")}</span>
          {streak.best > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{t(lang, "chathome.streakBest", { count: streak.best })}</span>}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="font-pixel text-2xl leading-none text-primary tabular-nums">{streak.current}</span>
          <span className="text-sm">{tn(lang, "chathome.streakUnit", streak.current)}</span>
        </div>
        <Link
          href={`${base}/approvals`}
          className={cn("mt-1.5 block text-xs hover:underline", streak.today === "waiting" ? "text-warn" : "text-muted-foreground")}
        >
          {streak.today === "waiting"
            ? tn(lang, "chathome.todayWaiting", streak.waitingToday)
            : streak.today === "clear"
              ? t(lang, "chathome.todayClear")
              : t(lang, "chathome.todayNone")}
        </Link>
      </div>

      <p className={cn("shrink-0 px-1 text-[11px] tabular-nums", spend.over ? "text-bad" : "text-muted-foreground")}>
        {t(lang, "manager.spend", { today: formatUsd(spend.today), cap: formatUsd(spend.cap), week: formatUsd(spend.week) })}
        {spend.over && t(lang, "manager.spendOver")}{" "}
        <Link href={`${base}/profile`} className="underline">
          {t(lang, "manager.budgetLink")}
        </Link>
      </p>
    </aside>
  );
}

/** Below lg the list folds into a row of chips above the chat. */
export function ConversationChips({ data, activeId, className }: { data: ConversationData; activeId: string | null; className?: string }) {
  const { businessId, lang, teammates, managerId, pendingApprovals, progress } = data;
  const base = `/b/${businessId}`;
  const manager = teammates.find((m) => m.id === managerId);
  const others = teammates.filter((m) => m.id !== managerId && m.kind === "ai");
  const chip = (active: boolean) =>
    cn("flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors", active ? "border-primary bg-secondary" : "border-secondary hover:bg-secondary/60");
  return (
    <div className={cn("-mx-1 flex shrink-0 items-center gap-1.5 overflow-x-auto px-1 pb-1", className)}>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-1 text-xs" title={t(lang, "chathome.xpHint")}>
        <span className="font-pixel text-primary tabular-nums">{t(lang, "chathome.level", { level: progress.team.level })}</span>
        <XpBar level={progress.team} className="w-10" />
        {progress.streak.current > 0 && <span className="text-muted-foreground tabular-nums">· {tn(lang, "chathome.streakDays", progress.streak.current)}</span>}
      </span>
      {manager && (
        <Link href={base} className={chip(activeId === manager.id)}>
          <Avatar seed={manager.id} name={manager.name} color={manager.color} size={20} />
          {manager.name}
          {pendingApprovals > 0 && <span className="rounded-full bg-warn px-1.5 font-semibold text-ink tabular-nums">{pendingApprovals}</span>}
        </Link>
      )}
      <Link href={`${base}/desk`} className={chip(false)}>
        <Headset aria-hidden className="size-3.5 text-info" />
        {t(lang, "chathome.customers")}
      </Link>
      {others.map((m) => (
        <Link key={m.id} href={`${base}/teammates/${m.id}`} className={chip(activeId === m.id)} title={statusLine(m, lang)}>
          <span className="relative">
            <Avatar seed={m.id} name={m.name} color={m.color} size={20} />
            <span className={cn("absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-1 ring-card", DOT[m.state])} />
          </span>
          {m.name}
        </Link>
      ))}
    </div>
  );
}
