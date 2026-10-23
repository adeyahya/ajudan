import Link from "next/link";
import { Field, Input, Section, cn } from "@/components/kit";
import { formatUsd, MAX_DAILY_BUDGET_USD, overBudget } from "@/lib/budget";
import type { getSpendRollup } from "@/lib/health";
import { t, type UiLang } from "@/lib/i18n";
import { languageName } from "@/lib/language";
import { LanguageSelect } from "@/app/language-select";
import { ActionForm, SubmitButton } from "../team/action-form";
import { saveDailyBudget, saveLanguage } from "./actions";

/** A stat tile: label 12 tertiary, value 20/28 600 tabular, a muted note. */
export function StatTile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-tertiary">{label}</div>
      <div className={cn("mt-1 text-xl leading-7 font-semibold tabular-nums", tone === "danger" ? "text-destructive" : "text-foreground")}>{value}</div>
      {note && <div className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{note}</div>}
    </div>
  );
}

/**
 * Usage & language tab: what the team's runs would cost at API prices (not a bill on a
 * Claude Code login), each teammate's share this week, an optional daily cap the worker
 * enforces (blank = none), and the business language.
 */
export function SpendPanel({
  businessId,
  spend,
  language,
  lang,
}: {
  businessId: string;
  spend: Awaited<ReturnType<typeof getSpendRollup>>;
  language: string;
  lang: UiLang;
}) {
  const over = overBudget(spend.today, spend.cap);
  const top = spend.byTeammateWeek[0]?.total ?? 0;
  return (
    <div>
      <Section title={t(lang, "profile.spend.title")} description={t(lang, "profile.spend.help")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label={t(lang, "profile.spend.today")}
            value={formatUsd(spend.today)}
            note={spend.cap > 0 ? t(lang, "profile.spend.of", { cap: formatUsd(spend.cap) }) : undefined}
            tone={over ? "danger" : undefined}
          />
          <StatTile label={t(lang, "profile.spend.week")} value={formatUsd(spend.week)} />
        </div>
        {over && <p className="mt-3 text-[13px] text-destructive">{t(lang, "profile.spend.over")}</p>}

        <div className="mt-5">
          <div className="text-xs text-tertiary">{t(lang, "profile.spend.byTeammate")}</div>
          {spend.byTeammateWeek.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">{t(lang, "profile.spend.none")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {spend.byTeammateWeek.map((m) => (
                <li key={m.teammateId} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="truncate text-foreground">{m.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${top > 0 ? Math.max(2, (m.total / top) * 100) : 0}%`, background: m.color }} />
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatUsd(m.total)} · {t(lang, "profile.spend.share", { pct: spend.week > 0 ? Math.round((m.total / spend.week) * 100) : 0 })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ActionForm action={saveDailyBudget.bind(null, businessId)} success={t(lang, "profile.toast.budget")} className="mt-5">
          <Field label={t(lang, "profile.spend.budget")} htmlFor="budget" hint={t(lang, "profile.spend.budgetHelp")}>
            <div className="flex items-center gap-2">
              <Input
                id="budget"
                name="budget"
                type="number"
                min={0}
                max={MAX_DAILY_BUDGET_USD}
                step="0.01"
                defaultValue={spend.cap > 0 ? spend.cap : ""}
                placeholder={t(lang, "profile.spend.noCap")}
                className="w-40 tabular-nums"
              />
              <SubmitButton size="sm" variant="secondary">
                {t(lang, "common.save")}
              </SubmitButton>
            </div>
          </Field>
        </ActionForm>
        <p className="mt-4 text-xs text-muted-foreground">
          <Link href={`/b/${businessId}/health`} className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
            {t(lang, "profile.healthLink")}
          </Link>
          {t(lang, "profile.healthHint")}
        </p>
      </Section>

      <Section title={t(lang, "profile.language.label")} description={`${t(lang, "profile.language.current", { language: languageName(language) })} ${t(lang, "profile.language.help")}`}>
        <ActionForm action={saveLanguage.bind(null, businessId)} success={t(lang, "profile.toast.language")} className="flex items-center gap-2">
          <LanguageSelect key={language} id="language" defaultValue={language} size="sm" className="w-48" />
          <SubmitButton size="sm" variant="secondary">
            {t(lang, "common.save")}
          </SubmitButton>
        </ActionForm>
      </Section>
    </div>
  );
}
