import { Headset } from "lucide-react";
import Link from "next/link";
import type { Teammate } from "@/db/schema";
import { Avatar, CountPill } from "@/components/kit";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, tn, type MessageKey, type UiLang } from "@/lib/i18n";
import type { LevelInfo, Progress } from "@/lib/progress";
import { stateDot } from "@/lib/status-tones";
import { cn } from "@/lib/utils";
import { NewTaskMenu, type TaskTarget } from "./new-task-menu";

/** What the list needs; loaded once by the chat home (and the teammate pages). */
export type ConversationData = {
  businessId: string;
  lang: UiLang;
  teammates: Teammate[];
  managerId: string | null;
  pendingApprovals: number;
  deskChats: number;
  progress: Progress;
};

const STATE_KEY: Record<Teammate["state"], MessageKey> = {
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

/** The one game accent left in the list: a pixel-font level tag. */
function LevelBadge({ level, lang }: { level: LevelInfo; lang: UiLang }) {
  return (
    <span
      title={t(lang, "chathome.levelTitle", { level: level.level, xp: level.xp })}
      className="font-game shrink-0 rounded-sm bg-muted px-1 text-xs leading-4 text-muted-foreground tabular-nums"
    >
      {t(lang, "chathome.level", { level: level.level })}
    </span>
  );
}

const ROW =
  "group flex h-11 items-center gap-2.5 rounded-md px-2 text-foreground transition-colors duration-100 hover:bg-hover aria-[current=page]:bg-accent";

/** Who can be given a task from the "+" menu: the manager first, then the AI teammates. */
export function taskTargets(data: ConversationData): TaskTarget[] {
  const base = `/b/${data.businessId}`;
  const manager = data.teammates.find((m) => m.id === data.managerId);
  const ai = data.teammates.filter((m) => m.id !== data.managerId && m.kind === "ai");
  return [
    ...(manager ? [{ id: manager.id, name: manager.name, color: manager.color, title: manager.title, href: `${base}?compose=1` }] : []),
    ...ai.map((m) => ({ id: m.id, name: m.name, color: m.color, title: m.title, href: `${base}/teammates/${m.id}?compose=1` })),
  ];
}

/**
 * The chat's left column (UI-PLAN §3.1): the manager pinned on top with what needs the
 * owner, the Customer Desk, then each teammate with live status and level, and the team's
 * progress folded into one line at the bottom. Server-rendered; LiveRefresh in the chat
 * re-renders it on every worker event.
 */
export function ConversationList({ data, activeId, className }: { data: ConversationData; activeId: string | null; className?: string }) {
  const { businessId, lang, teammates, managerId, pendingApprovals, deskChats, progress } = data;
  const base = `/b/${businessId}`;
  const manager = teammates.find((m) => m.id === managerId);
  const others = teammates.filter((m) => m.id !== managerId).sort((a, b) => Number(a.kind === "human") - Number(b.kind === "human"));

  return (
    <nav aria-label={t(lang, "chathome.conversations")} className={cn("min-h-0 flex-col border-r border-border bg-background", className)}>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <h2 className="text-[13px] leading-[18px] font-medium text-tertiary">{t(lang, "chathome.conversations")}</h2>
        <NewTaskMenu targets={taskTargets(data)} />
      </div>

      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-2">
        {manager && (
          <Link href={base} aria-current={activeId === manager.id ? "page" : undefined} className={ROW}>
            <Avatar seed={manager.id} name={manager.name} color={manager.color} size={32} status={stateDot(manager.state)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-5 font-medium">{manager.name}</span>
              <span className="block truncate text-xs text-tertiary">{statusLine(manager, lang)}</span>
            </span>
            {pendingApprovals > 0 && (
              <span title={tn(lang, "chathome.needsYou", pendingApprovals)}>
                <CountPill count={pendingApprovals} />
                <span className="sr-only">{tn(lang, "chathome.needsYou", pendingApprovals)}</span>
              </span>
            )}
          </Link>
        )}

        {others.map((m) => {
          const p = progress.mates[m.id];
          return (
            <Link key={m.id} href={`${base}/teammates/${m.id}`} aria-current={activeId === m.id ? "page" : undefined} className={ROW}>
              <Avatar seed={m.id} name={m.name} color={m.color} size={32} status={m.kind === "ai" ? stateDot(m.state) : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-5 font-medium">{m.name}</span>
                <span className="block truncate text-xs text-tertiary">{statusLine(m, lang)}</span>
              </span>
              {m.kind === "ai" && p && <LevelBadge level={p.level} lang={lang} />}
            </Link>
          );
        })}

        <div className="mx-2 my-1.5 border-t border-border" />

        <Link href={`${base}/desk`} className={ROW}>
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Headset className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm leading-5 font-medium">{t(lang, "chathome.customers")}</span>
            <span className="block truncate text-xs text-tertiary tabular-nums">
              {deskChats > 0 ? tn(lang, "chathome.customersSub", deskChats) : t(lang, "chathome.customersNone")}
            </span>
          </span>
        </Link>
      </div>

      <TeamProgress businessId={businessId} progress={progress} lang={lang} />
    </nav>
  );
}

/** Level, XP and the clean-queue streak in one 12px line with a 2px bar; the hints live in a tooltip. */
function TeamProgress({ businessId, progress, lang }: { businessId: string; progress: Progress; lang: UiLang }) {
  const { team, streak } = progress;
  const waiting = streak.today === "waiting";
  const pct = Math.round(Math.min(1, Math.max(0, team.pct)) * 100);
  return (
    <div className="shrink-0 border-t border-border px-4 pt-2.5 pb-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={`/b/${businessId}/approvals`}
            className={cn("block truncate rounded-sm text-xs tabular-nums transition-colors duration-100 hover:text-foreground", waiting ? "text-warning" : "text-tertiary")}
          >
            {t(lang, "chathome.progressLine", { level: team.level, xp: team.xp, next: team.next })}
            {streak.current > 0 && ` · ${tn(lang, "chathome.streakShort", streak.current)}`}
            {waiting && ` · ${tn(lang, "chathome.waitingShort", streak.waitingToday)}`}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 flex-col items-start gap-1 text-left">
          <span>{t(lang, "chathome.xpHint")}</span>
          <span>{t(lang, "chathome.streakHint")}</span>
          {streak.best > 0 && <span className="opacity-70">{t(lang, "chathome.streakBest", { count: streak.best })}</span>}
        </TooltipContent>
      </Tooltip>
      <div
        role="progressbar"
        aria-label={t(lang, "chathome.teamLevel", { level: team.level })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-(--ease) motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Below lg the list folds into a row of chips above the chat. */
export function ConversationChips({ data, activeId, className }: { data: ConversationData; activeId: string | null; className?: string }) {
  const { businessId, lang, teammates, managerId, pendingApprovals } = data;
  const base = `/b/${businessId}`;
  const manager = teammates.find((m) => m.id === managerId);
  const others = teammates.filter((m) => m.id !== managerId && m.kind === "ai");
  const chip =
    "flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border pr-3 pl-1.5 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-hover aria-[current=page]:border-transparent aria-[current=page]:bg-accent";
  return (
    <nav aria-label={t(lang, "chathome.conversations")} className={cn("flex shrink-0 items-center gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]", className)}>
      {manager && (
        <Link href={base} aria-current={activeId === manager.id ? "page" : undefined} className={chip}>
          <Avatar seed={manager.id} name={manager.name} color={manager.color} size={20} status={stateDot(manager.state)} />
          {manager.name}
          {pendingApprovals > 0 && <CountPill count={pendingApprovals} />}
        </Link>
      )}
      {others.map((m) => (
        <Link key={m.id} href={`${base}/teammates/${m.id}`} aria-current={activeId === m.id ? "page" : undefined} className={chip} title={statusLine(m, lang)}>
          <Avatar seed={m.id} name={m.name} color={m.color} size={20} status={stateDot(m.state)} />
          {m.name}
        </Link>
      ))}
      <Link href={`${base}/desk`} className={chip}>
        <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Headset className="size-3" strokeWidth={1.75} />
        </span>
        {t(lang, "chathome.customers")}
      </Link>
    </nav>
  );
}
