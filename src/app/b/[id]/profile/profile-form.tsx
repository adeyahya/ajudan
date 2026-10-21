"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label, Textarea } from "@/components/kit";
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

const AREAS: { key: keyof ProfileFields; label: string; hint?: string; rows: number }[] = [
  { key: "description", label: "Description", rows: 4 },
  { key: "products", label: "Products", hint: "One per line", rows: 4 },
  { key: "targetCustomers", label: "Target customers", hint: "One per line", rows: 3 },
  { key: "channels", label: "Channels", hint: "One per line", rows: 3 },
  { key: "brandVoice", label: "Brand voice", rows: 3 },
  { key: "competitors", label: "Competitors", hint: "One per line", rows: 3 },
  { key: "goals", label: "Goals (next ~90 days)", hint: "One per line: goal | metric | target", rows: 4 },
  { key: "constraints", label: "Constraints", hint: "One per line", rows: 3 },
  { key: "teamNeeds", label: "What the team should do", hint: "One per line", rows: 3 },
];

function Save() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>;
}

export function ProfileForm({
  action,
  initial,
}: {
  action: (prev: ProfileFormState, fd: FormData) => Promise<ProfileFormState>;
  initial: ProfileFields;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label>Name</Label>
          <Input name="name" defaultValue={initial.name} required />
        </div>
        <div className="grid gap-1">
          <Label>Website</Label>
          <Input name="website" defaultValue={initial.website} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label>One-liner</Label>
        <Input name="oneLiner" defaultValue={initial.oneLiner} />
      </div>
      {AREAS.map((a) => (
        <div key={a.key} className="grid gap-1">
          <Label>
            {a.label}
            {a.hint && <span className="font-normal"> ({a.hint})</span>}
          </Label>
          <Textarea name={a.key} rows={a.rows} defaultValue={initial[a.key]} />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Save />
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && <span className="text-xs text-muted-foreground">Saved. Your teammates now see the updated profile.</span>}
      </div>
    </form>
  );
}
