"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Autonomy } from "@/db/schema";
import { Field, Input, Textarea, cn } from "@/components/kit";
import { useLang, useT } from "@/components/i18n";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { MessageKey } from "@/lib/i18n";
import { autonomyOptions, buildCron, dayName, describeCron, parseCronPreset, type SchedulePreset } from "@/lib/onboarding/schedule";
import type { FormState } from "./actions";
import { SubmitButton } from "./action-form";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export { SubmitButton as PendingSubmit };

/** After a successful save: toast, then let the dialog close. */
function useSaved(state: FormState, message: string, onSaved?: () => void) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.ok && !state.error) {
      toast.success(message);
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per action result
  }, [state]);
}

function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] leading-[18px] text-destructive">
      {state.error}
    </p>
  );
}

/** A segmented choice (one of a few), posting its value in a hidden field. */
function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  label,
}: {
  name?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit max-w-full flex-wrap gap-0.5 rounded-md bg-secondary p-0.5">
      {name && <input type="hidden" name={name} value={value} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[5px] px-2.5 text-[13px] leading-[18px] font-medium transition-colors duration-100",
            value === o.value ? "bg-background text-foreground shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled switch row (posts "on" under `name` when checked). */
export function SwitchRow({
  name,
  label,
  help,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
}: {
  name?: string;
  label: ReactNode;
  help?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13px] leading-[18px] font-medium text-foreground">{label}</span>
        {help && <span className="mt-0.5 block text-xs text-muted-foreground">{help}</span>}
      </label>
      <Switch
        id={id}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}

export type TeammateInitial = {
  name: string;
  persona: string;
  responsibilities: string[];
  autonomy: Autonomy;
  schedule: string | null;
  schedulePrompt: string | null;
  browserAccess?: boolean;
  whatsappAccess?: boolean;
  shellAccess?: boolean;
  repoAccess?: boolean;
};

export function TeammateEditor({ action, initial, onSaved, footer }: { action: Action; initial: TeammateInitial; onSaved?: () => void; footer?: ReactNode }) {
  const t = useT();
  const options = autonomyOptions(useLang());
  const [state, formAction] = useActionState(action, {});
  const [autonomy, setAutonomy] = useState<Autonomy>(initial.autonomy);
  const [schedule, setSchedule] = useState(initial.schedule ?? "");
  const help = options.find((o) => o.value === autonomy)?.help;
  const ids = useId();
  useSaved(state, t("team.toast.saved", { name: initial.name }), onSaved);
  return (
    <form action={formAction} className="grid gap-5">
      <Field label={t("team.form.name")} htmlFor={`${ids}-name`}>
        <Input id={`${ids}-name`} name="name" defaultValue={initial.name} required />
      </Field>
      <Field label={t("team.form.brief")} hint={t("team.form.briefHelp")} htmlFor={`${ids}-brief`}>
        <Textarea id={`${ids}-brief`} name="persona" rows={5} defaultValue={initial.persona} placeholder={t("team.form.briefPlaceholder")} />
      </Field>
      <Field label={t("team.form.responsibilities")} htmlFor={`${ids}-resp`}>
        <Textarea id={`${ids}-resp`} name="responsibilities" rows={3} defaultValue={initial.responsibilities.join("\n")} required />
      </Field>
      <Field label={t("team.form.freedom")} hint={help}>
        <Segmented name="autonomy" label={t("team.form.freedom")} value={autonomy} onChange={setAutonomy} options={options.map((o) => ({ value: o.value, label: o.label }))} />
      </Field>
      <div className="grid gap-1.5">
        <span className="text-[13px] leading-[18px] font-medium text-foreground">{t("team.peek.access")}</span>
        <div className="divide-y divide-border rounded-md border border-border px-3">
          <SwitchRow name="browserAccess" defaultChecked={initial.browserAccess} label={t("team.form.browser")} help={t("team.form.browserHelp")} />
          <SwitchRow name="whatsappAccess" defaultChecked={initial.whatsappAccess} label={t("team.form.whatsapp")} help={t("team.form.whatsappHelp")} />
          <SwitchRow name="shellAccess" defaultChecked={initial.shellAccess} label={t("team.form.shell")} help={t("team.form.shellHelp")} />
          <SwitchRow name="repoAccess" defaultChecked={initial.repoAccess} label={t("team.form.repos")} help={t("team.form.reposHelp")} />
        </div>
      </div>
      <SchedulePicker value={schedule} onChange={setSchedule} />
      {schedule && (
        <Field label={t("team.form.onEachRun")} htmlFor={`${ids}-prompt`}>
          <Textarea id={`${ids}-prompt`} name="schedulePrompt" rows={2} defaultValue={initial.schedulePrompt ?? ""} />
        </Field>
      )}
      <FormError state={state} />
      <DialogFooter className="items-center">
        {footer}
        <SubmitButton>{t("team.form.save")}</SubmitButton>
      </DialogFooter>
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
  const id = useId();
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
    const preset: SchedulePreset = m === "weekly" ? { mode: "weekly", days: d, hour: h, minute: mi } : { mode: m, hour: h, minute: mi };
    onChange(buildCron(preset) ?? "");
  };

  return (
    <div className="grid gap-2">
      <input type="hidden" name="schedule" value={value} />
      <label htmlFor={`${id}-mode`} className="text-[13px] leading-[18px] font-medium text-foreground">
        {tr("team.form.recurring")}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={mode} onValueChange={(v) => emit({ mode: v as PickerMode })}>
          <SelectTrigger id={`${id}-mode`} size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {tr(o.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(mode === "daily" || mode === "weekdays" || mode === "weekly") && (
          <>
            <span className="text-[13px] text-muted-foreground">{tr("team.form.at")}</span>
            <Input
              type="time"
              aria-label={tr("team.form.time")}
              value={time}
              onChange={(e) => emit({ time: e.target.value || "09:00" })}
              className="h-7 w-28"
              required
            />
          </>
        )}
      </div>
      {mode === "weekly" && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={tr("team.form.mode.weekly")}>
          {DAY_ORDER.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => emit({ days: on ? days.filter((x) => x !== d) : [...days, d] })}
                className={cn(
                  "h-7 min-w-10 rounded-md border px-2 text-[13px] font-medium transition-colors duration-100",
                  on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {dayName(d, lang, true)}
              </button>
            );
          })}
        </div>
      )}
      {mode === "custom" && (
        <Input value={custom} onChange={(e) => emit({ custom: e.target.value })} placeholder={tr("team.form.cronPlaceholder")} className="font-mono text-[13px]" />
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

export function AddTeammateForm({
  action,
  roles,
  onSaved,
}: {
  action: Action;
  roles: { key: string; title: string; summary: string }[];
  onSaved?: () => void;
}) {
  const t = useT();
  const [state, formAction] = useActionState(action, {});
  const [role, setRole] = useState(roles[0]?.key ?? "");
  const ids = useId();
  useSaved(state, t("team.toast.added"), onSaved);
  const summary = roles.find((r) => r.key === role)?.summary;
  return (
    <form action={formAction} className="grid gap-5">
      <Field label={t("team.form.role")} hint={summary} htmlFor={`${ids}-role`}>
        <Select name="roleKey" value={role} onValueChange={setRole} required>
          <SelectTrigger id={`${ids}-role`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("team.form.name")} htmlFor={`${ids}-name`}>
        <Input id={`${ids}-name`} name="name" required placeholder={t("team.form.namePlaceholder")} />
      </Field>
      <Field label={t("team.form.focus")} hint={t("team.form.focusHelp")} htmlFor={`${ids}-focus`}>
        <Textarea id={`${ids}-focus`} name="persona" rows={3} placeholder={t("team.form.focusPlaceholder")} />
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <SubmitButton>{t("team.form.addTeammate")}</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** Add or edit a human teammate: name, what they do, WhatsApp number, what the team can ask them for. */
export function HumanForm({
  action,
  initial,
  submitLabel,
  onSaved,
  footer,
}: {
  action: Action;
  initial?: { name: string; title: string; phone: string | null; helps: string[] };
  submitLabel?: string;
  onSaved?: () => void;
  footer?: ReactNode;
}) {
  const t = useT();
  const [state, formAction] = useActionState(action, {});
  const ids = useId();
  useSaved(state, initial ? t("team.toast.saved", { name: initial.name }) : t("team.toast.personAdded"), onSaved);
  return (
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("team.form.name")} htmlFor={`${ids}-name`}>
          <Input id={`${ids}-name`} name="name" required defaultValue={initial?.name} placeholder={t("team.form.personNamePlaceholder")} />
        </Field>
        <Field label={t("team.form.whatTheyDo")} htmlFor={`${ids}-title`}>
          <Input id={`${ids}-title`} name="title" defaultValue={initial?.title} placeholder={t("team.form.whatTheyDoPlaceholder")} />
        </Field>
      </div>
      <Field label={t("team.form.phone")} htmlFor={`${ids}-phone`}>
        <Input
          id={`${ids}-phone`}
          name="phone"
          required
          inputMode="tel"
          defaultValue={initial?.phone ? `+${initial.phone}` : ""}
          placeholder="+62 812 3456 7890"
        />
      </Field>
      <Field label={t("team.form.helps")} htmlFor={`${ids}-helps`}>
        <Textarea id={`${ids}-helps`} name="helps" rows={3} defaultValue={initial?.helps.join("\n")} placeholder={t("team.form.helpsPlaceholder")} />
      </Field>
      <FormError state={state} />
      <DialogFooter className="items-center">
        {footer}
        <SubmitButton>{submitLabel ?? t("team.form.addPerson")}</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** A dialog that holds one of the forms above and closes when it saves. */
export function FormDialog({
  trigger,
  title,
  description,
  wide,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  trigger?: ReactNode;
  title: string;
  description?: string;
  wide?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn(wide ? "sm:max-w-xl" : "sm:max-w-md")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {open && children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}
