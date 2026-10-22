"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@/components/kit";
import type { FormState } from "../team/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Checking…" : "This is me"}
    </Button>
  );
}

/** Step 2 of the WhatsApp checklist, done in place: the owner's own number joins the team as the owner. */
export function OwnerNumberForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-2 text-sm sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
      <div className="grid gap-1">
        <Label>Your name</Label>
        <Input name="name" placeholder="e.g. Ade" />
      </div>
      <div className="grid gap-1">
        <Label>Your personal WhatsApp number</Label>
        <Input name="phone" required inputMode="tel" placeholder="+62 812 3456 7890" />
      </div>
      <Submit />
      {state.error && <p className="text-xs text-red-600 dark:text-red-400 sm:col-span-3">{state.error}</p>}
    </form>
  );
}
