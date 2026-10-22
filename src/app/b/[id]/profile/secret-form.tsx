"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";

type State = { error?: string; ok?: string };

/** Add or replace a credential. The value field is cleared after saving and never shown again. */
export function SecretForm({ action, name, hosts }: { action: (prev: State, fd: FormData) => Promise<State>; name?: string; hosts?: string[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const t = useT();
  return (
    <form action={formAction} className="grid gap-2 sm:grid-cols-2" autoComplete="off">
      <LangField />
      <div className="grid gap-1">
        <Label>{t("profile.secrets.name")}</Label>
        <Input name="name" required defaultValue={name} readOnly={!!name} placeholder="ORUCRAFT_API" className="font-mono text-xs uppercase" />
      </div>
      <div className="grid gap-1">
        <Label>{t("profile.secrets.hosts")}</Label>
        <Input name="hosts" required defaultValue={hosts?.join(", ")} placeholder="orucraft.com" />
      </div>
      <div className="grid gap-1 sm:col-span-2">
        <Label>{t("profile.secrets.value")}</Label>
        <Input name="value" type="password" required autoComplete="new-password" placeholder={t("profile.secrets.valuePlaceholder")} />
      </div>
      {!name && (
        <div className="grid gap-1 sm:col-span-2">
          <Label>{t("profile.secrets.note")}</Label>
          <Input name="note" placeholder={t("profile.secrets.notePlaceholder")} />
        </div>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : name ? t("profile.secrets.saveApprove") : t("profile.secrets.saveKey")}
        </Button>
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && <span className="text-xs text-muted-foreground">{state.ok}</span>}
      </div>
    </form>
  );
}
