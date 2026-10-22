"use client";

import { useActionState } from "react";
import { Button, Textarea } from "@/components/kit";
import { giveTask } from "./actions";

type Result = { ok: true; via: string | null } | { ok: false; error: string } | null;

/**
 * "Give a task" from the office. It goes to the manager with the picked teammate as a
 * hint (the owner's single point of contact), unless the picked teammate is the manager.
 */
export function TaskForm({ businessId, teammateId, name, viaManager }: { businessId: string; teammateId: string; name: string; viaManager: boolean }) {
  const [result, action, pending] = useActionState<Result, FormData>(async (_prev, formData) => {
    try {
      const via = await giveTask(formData);
      return { ok: true, via };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not assign the task" };
    }
  }, null);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="teammateId" value={teammateId} />
      <Textarea name="instructions" rows={3} required placeholder={`What should ${name} do next?`} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {result?.ok ? (
            result.via ? `Sent to ${result.via}, who will brief ${name}.` : "Task queued."
          ) : result?.ok === false ? (
            <span className="text-red-600">{result.error}</span>
          ) : viaManager ? (
            "Goes through your manager"
          ) : null}
        </span>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Give a task"}
        </Button>
      </div>
    </form>
  );
}
