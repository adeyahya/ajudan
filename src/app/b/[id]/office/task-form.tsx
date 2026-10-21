"use client";

import { useActionState } from "react";
import { Button, Textarea } from "@/components/kit";
import { assignTask } from "@/app/b/[id]/teammates/[tid]/actions";

type Result = { ok: true; at: number } | { ok: false; error: string } | null;

export function TaskForm({ businessId, teammateId, name }: { businessId: string; teammateId: string; name: string }) {
  const [result, action, pending] = useActionState<Result, FormData>(async (_prev, formData) => {
    try {
      await assignTask(formData);
      return { ok: true, at: Date.now() };
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
          {result?.ok ? "Task queued." : result?.ok === false ? <span className="text-red-600">{result.error}</span> : null}
        </span>
        <Button type="submit" disabled={pending}>
          {pending ? "Assigning…" : "Give a task"}
        </Button>
      </div>
    </form>
  );
}
