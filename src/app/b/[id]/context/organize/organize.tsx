"use client";

import { Brain, ListChecks, Sparkles } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT } from "@/components/i18n";
import { Avatar, Button, EmptyState, Prose, Section } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { dateLocale } from "@/lib/i18n";
import { decideAllReorganizeAction, reorganizeAction, setReorganizeWeeklyAction, tidyMemoryAction } from "../actions";
import { SuggestionItem } from "../context-peek";
import type { Mate, SuggestionView } from "../types";

type State = {
  status: "queued" | "running" | "done" | "failed" | null;
  error: string | null;
  weekly: boolean;
  lastRunAt: string | null;
  summary: string | null;
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * The review's controls (run now, weekly), the editor's note, every proposed change as
 * a suggestion card (Accept / Edit / Reject, or all at once), and teammates' memory with
 * "Tidy memory now". The worker does the Claude work; LiveRefresh brings the results in.
 */
export function OrganizeView({ businessId, state, proposals, mates, memories }: { businessId: string; state: State; proposals: SuggestionView[]; mates: Mate[]; memories: (Mate & { bytes: number })[] }) {
  const t = useT();
  const lang = useLang();
  const [pending, start] = useTransition();
  const [weekly, setWeekly] = useOptimistic(state.weekly);
  const [shown, hide] = useOptimistic(proposals, (list, ids: string[]) => list.filter((s) => !ids.includes(s.id)));
  const busy = state.status === "queued" || state.status === "running";

  const run = () =>
    start(async () => {
      const queued = await reorganizeAction(businessId);
      toast(queued ? t("context.organize.queuedToast") : t("context.organize.busy"));
    });
  const all = (accept: boolean) =>
    start(async () => {
      hide(shown.map((s) => s.id));
      const r = await decideAllReorganizeAction(businessId, accept);
      toast(accept ? t("context.organize.appliedAll", { count: r.done }) : t("context.organize.rejectedAll", { count: r.done }));
      if (r.failed) toast.error(t("context.organize.someFailed", { count: r.failed }));
    });
  const tidy = () =>
    start(async () => {
      const n = await tidyMemoryAction(businessId);
      toast(n ? t("context.organize.tidyQueued", { count: n }) : t("context.organize.tidyNothing"));
    });

  const when = state.lastRunAt ? new Date(state.lastRunAt).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-8 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} loading={busy || pending} disabled={busy || pending}>
              <Sparkles /> {t("context.organize.run")}
            </Button>
            <span className="text-[13px] text-muted-foreground" aria-live="polite">
              {state.status === "queued" ? t("context.organize.queued") : state.status === "running" ? t("context.organize.running") : when ? t("context.organize.lastRun", { when }) : t("context.organize.never")}
            </span>
          </div>
          {state.error && <p className="mt-3 rounded-md bg-destructive-soft px-3 py-2 text-xs text-tag-red-fg">{t("context.organize.failed", { error: state.error.slice(0, 300) })}</p>}
          <label className="mt-4 flex items-start gap-2.5 border-t border-border pt-4">
            <Switch
              className="mt-0.5"
              checked={weekly}
              onCheckedChange={(v) =>
                start(async () => {
                  setWeekly(v);
                  await setReorganizeWeeklyAction(businessId, v);
                })
              }
            />
            <span>
              <span className="block text-[13px] leading-[18px] font-medium">{t("context.organize.weekly")}</span>
              <span className="block text-xs text-muted-foreground">{t("context.organize.weeklyHelp")}</span>
            </span>
          </label>
        </div>

        {state.summary && shown.length > 0 && (
          <Section title={t("context.organize.summary")}>
            <div className="rounded-lg bg-muted px-4 py-3 text-[13px]">
              <Prose>{state.summary}</Prose>
            </div>
          </Section>
        )}

        <Section
          title={t("context.organize.proposals")}
          actions={
            shown.length > 1 && (
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => all(true)}>
                  {t("context.organize.acceptAll")}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => all(false)}>
                  {t("context.organize.rejectAll")}
                </Button>
              </div>
            )
          }
        >
          {shown.length === 0 ? (
            <EmptyState compact icon={<ListChecks />} title={t("context.organize.none")} body={t("context.organize.noneBody")} />
          ) : (
            <div className="divide-y divide-border">
              {shown.map((s) => (
                <div key={s.id} className="py-5 first:pt-0">
                  <SuggestionItem businessId={businessId} s={s} mate={mates.find((m) => m.id === s.authorId)} onDecided={(id) => hide([id])} showPage />
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <aside className="min-w-0">
        <Section title={t("context.organize.memory")} description={t("context.organize.memoryHelp")}>
          <ul className="mb-3">
            {memories.map((m) => (
              <li key={m.id} className="flex min-h-10 items-center gap-2.5 border-b border-border/70 py-1.5 last:border-b-0">
                <Avatar seed={m.id} name={m.name} color={m.color} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[18px] font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-tertiary">{m.title}</span>
                </span>
                <span className="shrink-0 text-xs text-tertiary tabular-nums">{m.bytes ? kb(m.bytes) : t("context.organize.memoryEmpty")}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" disabled={pending} onClick={tidy}>
            <Brain /> {t("context.organize.tidyMemory")}
          </Button>
        </Section>
      </aside>
    </div>
  );
}
