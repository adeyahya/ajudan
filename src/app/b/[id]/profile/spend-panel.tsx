import { Button, Input, Label } from "@/components/kit";
import { formatUsd, MAX_DAILY_BUDGET_USD } from "@/lib/budget";
import { saveDailyBudget } from "./actions";

/** What the team spent today and this week, and the daily cap the worker enforces. */
export function SpendPanel({ businessId, spend }: { businessId: string; spend: { today: number; week: number; cap: number; over: boolean } }) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-medium">Spend &amp; budget</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Claude usage by the whole team, from finished tasks. When today&apos;s spend reaches the daily budget, queued tasks wait until
          tomorrow or until you raise it.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">Today</dt>
          <dd className={`font-medium ${spend.over ? "text-red-600 dark:text-red-400" : ""}`}>
            {formatUsd(spend.today)} <span className="font-normal text-muted-foreground">of {formatUsd(spend.cap)}</span>
          </dd>
        </div>
        <div className="rounded-lg border border-border p-3">
          <dt className="text-xs text-muted-foreground">This week</dt>
          <dd className="font-medium">{formatUsd(spend.week)}</dd>
        </div>
      </dl>
      {spend.over && (
        <p className="text-xs text-red-600 dark:text-red-400">Today&apos;s budget is spent: the team&apos;s queued tasks are waiting.</p>
      )}
      <form action={saveDailyBudget.bind(null, businessId)} className="grid gap-2">
        <Label htmlFor="budget">Daily budget (USD)</Label>
        <div className="flex items-center gap-2">
          <Input id="budget" name="budget" type="number" min={1} max={MAX_DAILY_BUDGET_USD} step="1" defaultValue={spend.cap} className="w-32" required />
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
