"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Autonomy } from "@/db/schema";
import { Button, Input, Label, Textarea } from "@/components/kit";
import { AUTONOMY_OPTIONS, buildCron, DAY_NAMES, describeCron, parseCronPreset, type SchedulePreset } from "@/lib/onboarding/schedule";
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
  initial: {
    name: string;
    persona: string;
    responsibilities: string[];
    autonomy: Autonomy;
    schedule: string | null;
    schedulePrompt: string | null;
    browserAccess?: boolean;
    whatsappAccess?: boolean;
    shellAccess?: boolean;
  };
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
        <Label>Brief</Label>
        <Textarea
          name="persona"
          rows={4}
          defaultValue={initial.persona}
          placeholder="What this teammate should know and focus on for your business: products, customers, voice, what to avoid."
        />
        <p className="text-xs text-muted-foreground">Read before every task, together with your business profile.</p>
      </div>
      <div className="grid gap-1">
        <Label>Responsibilities (one per line)</Label>
        <Textarea name="responsibilities" rows={3} defaultValue={initial.responsibilities.join("\n")} required />
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
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" name="whatsappAccess" defaultChecked={initial.whatsappAccess} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          <span className="font-pixel">Can use WhatsApp</span>
          <span className="block text-xs text-muted-foreground">
            Reads and posts in the WhatsApp groups you allowed on the Business page. Posting follows the freedom setting above.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" name="shellAccess" defaultChecked={initial.shellAccess} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          <span className="font-pixel">Can run commands</span>
          <span className="block text-xs text-muted-foreground">
            A sandboxed shell for working with data (python, jq, curl): it only writes in this teammate&apos;s folder and only reaches
            the domains listed under Business → API keys &amp; access.
          </span>
        </span>
      </label>
      <SchedulePicker value={schedule} onChange={setSchedule} />
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

type PickerMode = "none" | SchedulePreset["mode"];
const MODES: { value: PickerMode; label: string }[] = [
  { value: "none", label: "No recurring work" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Chosen days" },
  { value: "custom", label: "Custom (cron)" },
];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Daily / weekdays / weekly-on-days at a time, or a raw cron for the rare case. The
 * cron string goes in the hidden "schedule" field, so the server action is unchanged.
 */
function SchedulePicker({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const initial = parseCronPreset(value);
  const [mode, setMode] = useState<PickerMode>(initial?.mode ?? "none");
  const [time, setTime] = useState(initial && initial.mode !== "custom" ? `${pad(initial.hour)}:${pad(initial.minute)}` : "09:00");
  const [days, setDays] = useState<number[]>(initial?.mode === "weekly" ? initial.days : [1]);
  const [custom, setCustom] = useState(initial?.mode === "custom" ? initial.expr : value);

  const emit = (next: { mode?: PickerMode; time?: string; days?: number[]; custom?: string }) => {
    const m = next.mode ?? mode;
    const t = next.time ?? time;
    const d = next.days ?? days;
    const c = next.custom ?? custom;
    if (next.mode !== undefined) setMode(next.mode);
    if (next.time !== undefined) setTime(next.time);
    if (next.days !== undefined) setDays(next.days);
    if (next.custom !== undefined) setCustom(next.custom);
    if (m === "none") return onChange("");
    if (m === "custom") return onChange(c.trim());
    const [h, mi] = t.split(":").map(Number);
    const preset: SchedulePreset =
      m === "weekly" ? { mode: "weekly", days: d, hour: h, minute: mi } : { mode: m, hour: h, minute: mi };
    onChange(buildCron(preset) ?? "");
  };

  return (
    <div className="grid gap-2">
      <input type="hidden" name="schedule" value={value} />
      <Label>Recurring work</Label>
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs ${mode === o.value ? "border-primary bg-primary/10 font-medium" : "border-border"}`}
          >
            <input type="radio" name="scheduleMode" value={o.value} checked={mode === o.value} onChange={() => emit({ mode: o.value })} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      {mode === "weekly" && (
        <div className="flex flex-wrap gap-1.5">
          {DAY_ORDER.map((d) => {
            const on = days.includes(d);
            return (
              <label
                key={d}
                className={`cursor-pointer rounded-lg border px-2 py-1 text-xs ${on ? "border-primary bg-primary/10 font-medium" : "border-border"}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => emit({ days: on ? days.filter((x) => x !== d) : [...days, d] })}
                  className="sr-only"
                />
                {DAY_NAMES[d].slice(0, 3)}
              </label>
            );
          })}
        </div>
      )}
      {(mode === "daily" || mode === "weekdays" || mode === "weekly") && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">at</span>
          <Input type="time" value={time} onChange={(e) => emit({ time: e.target.value || "09:00" })} className="w-32" required />
        </div>
      )}
      {mode === "custom" && (
        <Input value={custom} onChange={(e) => emit({ custom: e.target.value })} placeholder="0 9 * * 1  (Mondays 09:00)" />
      )}
      {mode !== "none" && (
        <p className="text-xs text-muted-foreground">
          {value ? describeCron(value) : mode === "weekly" ? "Pick at least one day." : "Enter a cron expression."}
          {mode === "custom" && value ? ` (${value})` : ""}
          {mode !== "custom" ? " Runs at most once an hour; times are this computer's." : " Runs at most once an hour."}
        </p>
      )}
    </div>
  );
}

export function AddTeammateForm({ action, roles }: { action: Action; roles: { key: string; title: string; summary: string }[] }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 text-sm">
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
      <div className="grid gap-1 sm:col-span-2">
        <Label>What should they focus on? (optional)</Label>
        <Textarea
          name="persona"
          rows={2}
          placeholder="e.g. Weekly TikTok scripts for our wooden toys, playful tone, never mention competitors by name."
        />
        <p className="text-xs text-muted-foreground">Leave it empty and we write a brief from your business profile. You can edit it any time.</p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Submit>Add teammate</Submit>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}

/** Add or edit a human teammate: name, what they do, WhatsApp number, what the team can ask them for. */
export function HumanForm({
  action,
  initial,
  submitLabel = "Add person",
}: {
  action: Action;
  initial?: { name: string; title: string; phone: string | null; helps: string[] };
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 text-sm sm:grid-cols-3">
      <div className="grid gap-1">
        <Label>Name</Label>
        <Input name="name" required defaultValue={initial?.name} placeholder="e.g. Budi" />
      </div>
      <div className="grid gap-1">
        <Label>What they do</Label>
        <Input name="title" defaultValue={initial?.title} placeholder="e.g. Videographer" />
      </div>
      <div className="grid gap-1">
        <Label>WhatsApp number</Label>
        <Input name="phone" required inputMode="tel" defaultValue={initial?.phone ? `+${initial.phone}` : ""} placeholder="+62 812 3456 7890" />
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label>The team can ask them for (one per line)</Label>
        <Textarea
          name="helps"
          rows={3}
          defaultValue={initial?.helps.join("\n")}
          placeholder={"Product footage and B-roll\nProduct photos\nChecking stock in the workshop"}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Submit variant={initial ? "secondary" : "primary"}>{submitLabel}</Submit>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && !state.error && <span className="text-xs text-muted-foreground">{initial ? "Saved" : "Added"}</span>}
      </div>
    </form>
  );
}
