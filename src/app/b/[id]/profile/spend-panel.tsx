import { Button, Input, Label } from "@/components/kit";
import { formatUsd, MAX_DAILY_BUDGET_USD } from "@/lib/budget";
import { t, type UiLang } from "@/lib/i18n";
import { saveDailyBudget } from "./actions";

/** What the team spent today and this week, and the daily cap the worker enforces. */
export function SpendPanel({
  businessId,
  spend,
  lang,
}: {
  businessId: string;
  spend: { today: number; week: number; cap: number; over: boolean };
  lang: UiLang;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-medium">{t(lang, "profile.spend.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t(lang, "profile.spend.help")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{t(lang, "profile.spend.today")}</dt>
          <dd className={`font-medium ${spend.over ? "text-red-600 dark:text-red-400" : ""}`}>
            {formatUsd(spend.today)} <span className="font-normal text-muted-foreground">{t(lang, "profile.spend.of", { cap: formatUsd(spend.cap) })}</span>
          </dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">{t(lang, "profile.spend.week")}</dt>
          <dd className="font-medium">{formatUsd(spend.week)}</dd>
        </div>
      </dl>
      {spend.over && (
        <p className="text-xs text-red-600 dark:text-red-400">{t(lang, "profile.spend.over")}</p>
      )}
      <form action={saveDailyBudget.bind(null, businessId)} className="grid gap-2">
        <Label htmlFor="budget">{t(lang, "profile.spend.budget")}</Label>
        <div className="flex items-center gap-2">
          <Input id="budget" name="budget" type="number" min={1} max={MAX_DAILY_BUDGET_USD} step="0.01" defaultValue={spend.cap} className="w-32" required />
          <Button type="submit" variant="secondary">
            {t(lang, "common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
