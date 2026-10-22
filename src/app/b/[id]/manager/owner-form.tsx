"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";
import type { FormState } from "../team/actions";

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? t("manager.owner.checking") : t("manager.owner.submit")}
    </Button>
  );
}

/** Step 2 of the WhatsApp checklist, done in place: the owner's own number joins the team as the owner. */
export function OwnerNumberForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, {});
  const t = useT();
  return (
    <form action={formAction} className="grid gap-2 text-sm sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
      <LangField />
      <div className="grid gap-1">
        <Label>{t("manager.owner.name")}</Label>
        <Input name="name" placeholder={t("manager.owner.namePlaceholder")} />
      </div>
      <div className="grid gap-1">
        <Label>{t("manager.owner.phone")}</Label>
        <Input name="phone" required inputMode="tel" placeholder="+62 812 3456 7890" />
      </div>
      <Submit />
      {state.error && <p className="text-xs text-red-600 dark:text-red-400 sm:col-span-3">{state.error}</p>}
    </form>
  );
}
