import Link from "next/link";
import { Field, Input, Section, cn } from "@/components/kit";
import { formatUsd, MAX_DAILY_BUDGET_USD } from "@/lib/budget";
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

/** Budget & language tab: what the team spent, the daily cap the worker enforces, and the business language. */
export function SpendPanel({
  businessId,
  spend,
  language,
  lang,
}: {
  businessId: string;
  spend: { today: number; week: number; cap: number; over: boolean };
  language: string;
  lang: UiLang;
}) {
  return (
    <div>
      <Section title={t(lang, "profile.spend.title")} description={t(lang, "profile.spend.help")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label={t(lang, "profile.spend.today")}
            value={formatUsd(spend.today)}
            note={t(lang, "profile.spend.of", { cap: formatUsd(spend.cap) })}
            tone={spend.over ? "danger" : undefined}
          />
          <StatTile label={t(lang, "profile.spend.week")} value={formatUsd(spend.week)} />
        </div>
        {spend.over && <p className="mt-3 text-[13px] text-destructive">{t(lang, "profile.spend.over")}</p>}
        <ActionForm action={saveDailyBudget.bind(null, businessId)} success={t(lang, "profile.toast.budget")} className="mt-5">
          <Field label={t(lang, "profile.spend.budget")} htmlFor="budget">
            <div className="flex items-center gap-2">
              <Input id="budget" name="budget" type="number" min={1} max={MAX_DAILY_BUDGET_USD} step="0.01" defaultValue={spend.cap} className="w-32 tabular-nums" required />
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
