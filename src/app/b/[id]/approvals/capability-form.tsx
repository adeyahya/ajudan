"use client";

import { useActionState } from "react";
import { Button, Input, Label } from "@/components/kit";
import { useT } from "@/components/i18n";

type State = { error?: string; ok?: string };

/**
 * Approve a teammate's request for an ability. A credential request asks for the value
 * here (a password field: it goes to the Keychain, never into the chat).
 */
export function CapabilityForm({
  approve,
  reject,
  secret,
}: {
  approve: (prev: State, fd: FormData) => Promise<State>;
  reject: (fd: FormData) => Promise<void>;
  secret?: { name: string; hosts: string[] };
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(approve, {});
  return (
    <div className="grid gap-2">
      <form action={formAction} className="grid gap-2" autoComplete="off">
        {secret && (
          <div className="grid gap-1">
            <Label>
              {t("approvals.secretValueOf")} <code className="font-mono">{secret.name}</code>{" "}
              {t("approvals.secretOnlyTo", { hosts: secret.hosts.join(", ") })}
            </Label>
            <Input name="value" type="password" required autoComplete="new-password" placeholder={t("approvals.secretPlaceholder")} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input name="note" placeholder={t("approvals.notePlaceholder")} className="min-w-48 flex-1" />
          <Button type="submit" disabled={pending}>
            {pending ? t("approvals.approving") : secret ? t("approvals.saveApprove") : t("approvals.approve")}
          </Button>
          <Button type="submit" variant="secondary" formAction={reject} formNoValidate>
            {t("approvals.reject")}
          </Button>
        </div>
        {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
      </form>
    </div>
  );
}
