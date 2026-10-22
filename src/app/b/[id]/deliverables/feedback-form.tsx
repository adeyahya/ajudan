"use client";

import { useActionState } from "react";
import { Button, Textarea } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";
import { giveFeedback, type FeedbackState } from "./actions";

/**
 * The owner's verdict on a piece of work. "Needs changes" needs a note (it goes to the
 * teammate as a revision); "Looks good" takes one optionally. Both are remembered by
 * the teammate (memory.md) and, with a note, by the whole team (TEAM.md).
 */
export function FeedbackForm({ businessId, deliverableId, canRevise }: { businessId: string; deliverableId: string; canRevise: boolean }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<FeedbackState, FormData>(giveFeedback, {});
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="deliverableId" value={deliverableId} />
      <LangField />
      <Textarea
        name="note"
        rows={2}
        required={canRevise}
        placeholder={canRevise ? t("work.fb.placeholderRevise") : t("work.fb.placeholderGood")}
        className="text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="verdict" value="good" variant="secondary" formNoValidate disabled={pending} className="h-7 px-2.5 text-xs">
          {t("work.fb.good")}
        </Button>
        {canRevise && (
          <Button type="submit" name="verdict" value="changes" variant="secondary" disabled={pending} className="h-7 px-2.5 text-xs">
            {t("work.fb.changes")}
          </Button>
        )}
        {state.error && <span className="text-xs text-red-600 dark:text-red-400">{state.error}</span>}
        {state.ok && !state.error && <span className="text-xs text-muted-foreground">{state.ok}</span>}
      </div>
    </form>
  );
}
