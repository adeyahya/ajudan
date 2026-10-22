"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";
import { DialogFooter } from "@/components/ui/dialog";
import { SubmitButton } from "../team/action-form";
import { FormDialog } from "../team/forms";

type State = { error?: string; ok?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

/** Add or replace a credential. The value field is never shown again after saving. */
export function SecretForm({ action, name, hosts, onSaved }: { action: Action; name?: string; hosts?: string[]; onSaved?: () => void }) {
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
      toast.success(state.ok);
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per action result
  }, [state]);
  return (
    <form action={formAction} className="grid gap-5" autoComplete="off">
      <LangField />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("profile.secrets.name")} htmlFor={`${ids}-name`}>
          <Input id={`${ids}-name`} name="name" required defaultValue={name} readOnly={!!name} placeholder="ORUCRAFT_API" className="font-mono text-[13px] uppercase" />
        </Field>
        <Field label={t("profile.secrets.hosts")} htmlFor={`${ids}-hosts`}>
          <Input id={`${ids}-hosts`} name="hosts" required defaultValue={hosts?.join(", ")} placeholder="orucraft.com" />
        </Field>
      </div>
      <Field label={t("profile.secrets.value")} htmlFor={`${ids}-value`}>
        <Input id={`${ids}-value`} name="value" type="password" required autoComplete="new-password" placeholder={t("profile.secrets.valuePlaceholder")} />
      </Field>
      {!name && (
        <Field label={t("profile.secrets.note")} htmlFor={`${ids}-note`}>
          <Input id={`${ids}-note`} name="note" placeholder={t("profile.secrets.notePlaceholder")} />
        </Field>
      )}
      {state.error && (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-[13px] leading-[18px] text-destructive">
          {state.error}
        </p>
      )}
      <DialogFooter>
        <SubmitButton>{name ? t("profile.secrets.saveApprove") : t("profile.secrets.saveKey")}</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** "Add credential" → dialog. */
export function AddSecretDialog({ action }: { action: Action }) {
  const t = useT();
  return (
    <FormDialog
      wide
      title={t("profile.secrets.add")}
      description={t("profile.secrets.help")}
      trigger={
        <Button size="sm">
          <Plus />
          {t("profile.secrets.add")}
        </Button>
      }
    >
      {(close) => <SecretForm action={action} onSaved={close} />}
    </FormDialog>
  );
}
