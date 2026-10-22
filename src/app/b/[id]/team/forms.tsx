"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Autonomy } from "@/db/schema";
import { Button, Input, Label, Textarea } from "@/components/kit";
import { useLang, useT } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n";
import { autonomyOptions, buildCron, dayName, describeCron, parseCronPreset, type SchedulePreset } from "@/lib/onboarding/schedule";
import type { FormState } from "./actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? t("team.form.working") : children}
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
  const t = useT();
  const options = autonomyOptions(useLang());
  const [state, formAction] = useActionState(action, {});
  const [autonomy, setAutonomy] = useState<Autonomy>(initial.autonomy);
  const [schedule, setSchedule] = useState(initial.schedule ?? "");
  const help = options.find((o) => o.value === autonomy)?.help;
  return (
    <form action={formAction} className="grid gap-3 text-sm">
      <div className="grid gap-1">
        <Label>{t("team.form.name")}</Label>
        <Input name="name" defaultValue={initial.name} required />
      </div>
      <div className="grid gap-1">
        <Label>{t("team.form.brief")}</Label>
        <Textarea
          name="persona"
          rows={4}
          defaultValue={initial.persona}
          placeholder={t("team.form.briefPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">{t("team.form.briefHelp")}</p>
      </div>
      <div className="grid gap-1">
        <Label>{t("team.form.responsibilities")}</Label>
        <Textarea name="responsibilities" rows={3} defaultValue={initial.responsibilities.join("\n")} required />
      </div>
      <div className="grid gap-1">
        <Label>{t("team.form.freedom")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
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
          <span className="font-pixel">{t("team.form.browser")}</span>
          <span className="block text-xs text-muted-foreground">{t("team.form.browserHelp")}</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" name="whatsappAccess" defaultChecked={initial.whatsappAccess} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          <span className="font-pixel">{t("team.form.whatsapp")}</span>
          <span className="block text-xs text-muted-foreground">{t("team.form.whatsappHelp")}</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" name="shellAccess" defaultChecked={initial.shellAccess} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          <span className="font-pixel">{t("team.form.shell")}</span>
          <span className="block text-xs text-muted-foreground">{t("team.form.shellHelp")}</span>
        </span>
      </label>
      <SchedulePicker value={schedule} onChange={setSchedule} />
      {schedule && (
        <div className="grid gap-1">
          <Label>{t("team.form.onEachRun")}</Label>
          <Textarea name="schedulePrompt" rows={2} defaultValue={initial.schedulePrompt ?? ""} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Submit variant="secondary">{t("team.form.save")}</Submit>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && !state.error && <span className="text-xs text-muted-foreground">{t("team.form.saved")}</span>}
      </div>
    </form>
  );
}

type PickerMode = "none" | SchedulePreset["mode"];
const MODES: { value: PickerMode; label: MessageKey }[] = [
  { value: "none", label: "team.form.mode.none" },
  { value: "daily", label: "team.form.mode.daily" },
  { value: "weekdays", label: "team.form.mode.weekdays" },
  { value: "weekly", label: "team.form.mode.weekly" },
  { value: "custom", label: "team.form.mode.custom" },
];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Daily / weekdays / weekly-on-days at a time, or a raw cron for the rare case. The
 * cron string goes in the hidden "schedule" field, so the server action is unchanged.
 */
function SchedulePicker({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const tr = useT();
  const lang = useLang();
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
      <Label>{tr("team.form.recurring")}</Label>
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((o) => (
          <label
            key={o.value}
            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs ${mode === o.value ? "border-primary bg-primary/10 font-medium" : "border-border"}`}
          >
            <input type="radio" name="scheduleMode" value={o.value} checked={mode === o.value} onChange={() => emit({ mode: o.value })} className="sr-only" />
            {tr(o.label)}
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
                {dayName(d, lang, true)}
              </label>
            );
          })}
        </div>
      )}
      {(mode === "daily" || mode === "weekdays" || mode === "weekly") && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{tr("team.form.at")}</span>
          <Input type="time" value={time} onChange={(e) => emit({ time: e.target.value || "09:00" })} className="w-32" required />
        </div>
      )}
      {mode === "custom" && (
        <Input value={custom} onChange={(e) => emit({ custom: e.target.value })} placeholder={tr("team.form.cronPlaceholder")} />
      )}
      {mode !== "none" && (
        <p className="text-xs text-muted-foreground">
          {value ? describeCron(value, lang) : mode === "weekly" ? tr("team.form.pickDay") : tr("team.form.enterCron")}
          {mode === "custom" && value ? ` (${value})` : ""}
          {mode !== "custom" ? tr("team.form.limitLocal") : tr("team.form.limit")}
        </p>
      )}
    </div>
  );
}

export function AddTeammateForm({ action, roles }: { action: Action; roles: { key: string; title: string; summary: string }[] }) {
  const t = useT();
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2 text-sm">
      <div className="grid gap-1">
        <Label>{t("team.form.role")}</Label>
        <select name="roleKey" required className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
          {roles.map((r) => (
            <option key={r.key} value={r.key} title={r.summary}>
              {r.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label>{t("team.form.name")}</Label>
        <Input name="name" required placeholder={t("team.form.namePlaceholder")} />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label>{t("team.form.focus")}</Label>
        <Textarea
          name="persona"
          rows={2}
          placeholder={t("team.form.focusPlaceholder")}
        />
        <p className="text-xs text-muted-foreground">{t("team.form.focusHelp")}</p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Submit>{t("team.form.addTeammate")}</Submit>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}

/** Add or edit a human teammate: name, what they do, WhatsApp number, what the team can ask them for. */
export function HumanForm({
  action,
  initial,
  submitLabel,
}: {
  action: Action;
  initial?: { name: string; title: string; phone: string | null; helps: string[] };
  submitLabel?: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 text-sm sm:grid-cols-3">
      <div className="grid gap-1">
        <Label>{t("team.form.name")}</Label>
        <Input name="name" required defaultValue={initial?.name} placeholder={t("team.form.personNamePlaceholder")} />
      </div>
      <div className="grid gap-1">
        <Label>{t("team.form.whatTheyDo")}</Label>
        <Input name="title" defaultValue={initial?.title} placeholder={t("team.form.whatTheyDoPlaceholder")} />
      </div>
      <div className="grid gap-1">
        <Label>{t("team.form.phone")}</Label>
        <Input name="phone" required inputMode="tel" defaultValue={initial?.phone ? `+${initial.phone}` : ""} placeholder="+62 812 3456 7890" />
      </div>
      <div className="grid gap-1 sm:col-span-3">
        <Label>{t("team.form.helps")}</Label>
        <Textarea
          name="helps"
          rows={3}
          defaultValue={initial?.helps.join("\n")}
          placeholder={t("team.form.helpsPlaceholder")}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Submit variant={initial ? "secondary" : "primary"}>{submitLabel ?? t("team.form.addPerson")}</Submit>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && !state.error && <span className="text-xs text-muted-foreground">{initial ? t("team.form.saved") : t("team.form.added")}</span>}
      </div>
    </form>
  );
}
