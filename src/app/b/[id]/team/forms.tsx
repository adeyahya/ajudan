"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Autonomy } from "@/db/schema";
import { Button, Input, Label, Textarea } from "@/components/kit";
import { AUTONOMY_OPTIONS } from "@/lib/onboarding/schedule";
import type { FormState } from "./actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

export { Submit as PendingSubmit };

export function TeammateEditor({
  action,
  initial,
}: {
  action: Action;
  initial: { name: string; autonomy: Autonomy; schedule: string | null; schedulePrompt: string | null; browserAccess?: boolean };
}) {
  const [state, formAction] = useActionState(action, {});
  const [autonomy, setAutonomy] = useState<Autonomy>(initial.autonomy);
  const [schedule, setSchedule] = useState(initial.schedule ?? "");
  const help = AUTONOMY_OPTIONS.find((o) => o.value === autonomy)?.help;
  return (
    <form action={formAction} className="grid gap-3 text-sm">
      <div className="grid gap-1">
        <Label>Name</Label>
        <Input name="name" defaultValue={initial.name} required />
      </div>
      <div className="grid gap-1">
        <Label>How much freedom?</Label>
        <div className="flex flex-wrap gap-1.5">
          {AUTONOMY_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs ${
                autonomy === o.value ? "border-primary bg-primary/10 font-medium" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="autonomy"
                value={o.value}
                checked={autonomy === o.value}
                onChange={() => setAutonomy(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" name="browserAccess" defaultChecked={initial.browserAccess} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          <span className="font-pixel">Can use the business browser</span>
          <span className="block text-xs text-muted-foreground">
            Drives your logged-in Chrome (Shopee, TikTok…). Changes on a site still follow the freedom setting above.
          </span>
        </span>
      </label>
      <div className="grid gap-1">
        <Label>Recurring schedule (cron, blank for none)</Label>
        <div className="flex gap-2">
          <Input name="schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 9 * * 1  (Mondays 09:00)" />
          {schedule && (
            <Button type="button" variant="ghost" onClick={() => setSchedule("")}>
              Clear
            </Button>
          )}
        </div>
      </div>
      {schedule && (
        <div className="grid gap-1">
          <Label>On each run</Label>
          <Textarea name="schedulePrompt" rows={2} defaultValue={initial.schedulePrompt ?? ""} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Submit variant="secondary">Save</Submit>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && !state.error && <span className="text-xs text-muted-foreground">Saved</span>}
      </div>
    </form>
  );
}

export function AddTeammateForm({ action, roles }: { action: Action; roles: { key: string; title: string; summary: string }[] }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end text-sm">
      <div className="grid gap-1">
        <Label>Role</Label>
        <select name="roleKey" required className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
          {roles.map((r) => (
            <option key={r.key} value={r.key} title={r.summary}>
              {r.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label>Name</Label>
        <Input name="name" required placeholder="e.g. Sam" />
      </div>
      <Submit>Add teammate</Submit>
      {state.error && <p className="text-xs text-red-600 dark:text-red-400 sm:col-span-3">{state.error}</p>}
    </form>
  );
}
