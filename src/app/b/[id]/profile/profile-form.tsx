"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label, Textarea } from "@/components/kit";
import { useT } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { ProfileFormState } from "./actions";

export type ProfileFields = Record<
  | "name"
  | "website"
  | "oneLiner"
  | "description"
  | "products"
  | "targetCustomers"
  | "channels"
  | "brandVoice"
  | "competitors"
  | "goals"
  | "constraints"
  | "teamNeeds",
  string
>;

const AREAS: { key: keyof ProfileFields; label: MessageKey; hint?: MessageKey; rows: number }[] = [
  { key: "description", label: "profile.form.description", rows: 4 },
  { key: "products", label: "profile.products", hint: "profile.form.onePerLine", rows: 4 },
  { key: "targetCustomers", label: "profile.targetCustomers", hint: "profile.form.onePerLine", rows: 3 },
  { key: "channels", label: "profile.channels", hint: "profile.form.onePerLine", rows: 3 },
  { key: "brandVoice", label: "profile.brandVoice", rows: 3 },
  { key: "competitors", label: "profile.competitors", hint: "profile.form.onePerLine", rows: 3 },
  { key: "goals", label: "profile.form.goals", hint: "profile.form.goalsHint", rows: 4 },
  { key: "constraints", label: "profile.constraints", hint: "profile.form.onePerLine", rows: 3 },
  { key: "teamNeeds", label: "profile.teamNeeds", hint: "profile.form.onePerLine", rows: 3 },
];

function Save() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button disabled={pending}>{pending ? t("common.saving") : t("profile.form.save")}</Button>;
}

export function ProfileForm({
  action,
  initial,
}: {
  action: (prev: ProfileFormState, fd: FormData) => Promise<ProfileFormState>;
  initial: ProfileFields;
}) {
  const [state, formAction] = useActionState(action, {});
  const t = useT();
  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label>{t("profile.form.name")}</Label>
          <Input name="name" defaultValue={initial.name} required />
        </div>
        <div className="grid gap-1">
          <Label>{t("profile.form.website")}</Label>
          <Input name="website" defaultValue={initial.website} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>{t("profile.form.oneLiner")}</Label>
        <Input name="oneLiner" defaultValue={initial.oneLiner} />
      </div>
      {AREAS.map((a) => (
        <div key={a.key} className="grid gap-1">
          <Label>
            {t(a.label)}
            {a.hint && <span className="font-normal"> ({t(a.hint)})</span>}
          </Label>
          <Textarea name={a.key} rows={a.rows} defaultValue={initial[a.key]} />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && <span className="text-xs text-muted-foreground">{t("profile.form.saved")}</span>}
      </div>
    </form>
  );
}
