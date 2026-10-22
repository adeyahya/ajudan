"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { Button, Field, Input, Textarea } from "@/components/kit";
import { useT } from "@/components/i18n";
import { DialogFooter } from "@/components/ui/dialog";
import type { MessageKey } from "@/lib/i18n";
import { SubmitButton } from "../team/action-form";
import { FormDialog } from "../team/forms";
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

type Action = (prev: ProfileFormState, fd: FormData) => Promise<ProfileFormState>;

export function ProfileForm({ action, initial, onSaved }: { action: Action; initial: ProfileFields; onSaved?: () => void }) {
  const [state, formAction] = useActionState(action, {});
  const t = useT();
  const ids = useId();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (state.ok) {
      toast.success(t("profile.form.saved"));
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per action result
  }, [state]);
  return (
    <form action={formAction} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("profile.form.name")} htmlFor={`${ids}-name`}>
          <Input id={`${ids}-name`} name="name" defaultValue={initial.name} required />
        </Field>
        <Field label={t("profile.form.website")} htmlFor={`${ids}-website`}>
          <Input id={`${ids}-website`} name="website" defaultValue={initial.website} placeholder="https://" />
        </Field>
      </div>
      <Field label={t("profile.form.oneLiner")} htmlFor={`${ids}-one`}>
        <Input id={`${ids}-one`} name="oneLiner" defaultValue={initial.oneLiner} />
      </Field>
      {AREAS.map((a) => (
        <Field key={a.key} label={t(a.label)} hint={a.hint && t(a.hint)} htmlFor={`${ids}-${a.key}`}>
          <Textarea id={`${ids}-${a.key}`} name={a.key} rows={a.rows} defaultValue={initial[a.key]} />
        </Field>
      ))}
      {state.error && (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] leading-[18px] text-destructive">
          {state.error}
        </p>
      )}
      <DialogFooter className="sticky -bottom-5 -mx-5 -mb-5 border-t border-border bg-popover px-5 py-3">
        <SubmitButton>{t("profile.form.save")}</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** "Edit profile" in the page header → the whole profile in a scrollable dialog. */
export function EditProfileDialog({ action, initial, interviewHref }: { action: Action; initial: ProfileFields; interviewHref: string }) {
  const t = useT();
  return (
    <FormDialog
      wide
      title={t("profile.editProfile")}
      description={`${t("profile.editHintBefore")} ${t("profile.editHintLink")} ${t("profile.editHintAfter")}`}
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil />
          {t("profile.editProfile")}
        </Button>
      }
    >
      {(close) => (
        <>
          <p className="-mt-2 text-xs">
            <Link href={interviewHref} className="text-primary hover:underline">
              {t("profile.openInterview")}
            </Link>
          </p>
          <ProfileForm action={action} initial={initial} onSaved={close} />
        </>
      )}
    </FormDialog>
  );
}
