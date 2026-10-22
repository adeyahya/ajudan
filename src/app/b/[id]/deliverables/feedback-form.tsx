"use client";

import { PencilLine, ThumbsUp } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Textarea, cn } from "@/components/kit";
import { LangField, useT } from "@/components/i18n";
import { giveFeedback, type FeedbackState } from "./actions";

type Verdict = "good" | "changes";

/**
 * The owner's verdict on a piece of work: a two-option segmented control, then a note.
 * "Needs changes" needs a note (it goes to the teammate as a revision); "Looks good" takes
 * one optionally. Both are remembered by the teammate (memory.md) and, with a note, by the
 * whole team (TEAM.md). Success is a toast; a field error stays inline.
 */
export function FeedbackForm({ businessId, deliverableId, canRevise }: { businessId: string; deliverableId: string; canRevise: boolean }) {
  const t = useT();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<FeedbackState, FormData>(async (prev, fd) => {
    const r = await giveFeedback(prev, fd);
    if (r.ok && !r.error) {
      toast.success(r.ok);
      setVerdict(null);
      formRef.current?.reset();
    }
    return r;
  }, {});

  const options: { value: Verdict; label: string; icon: React.ReactNode }[] = [
    { value: "good", label: t("work.fb.good"), icon: <ThumbsUp aria-hidden /> },
    ...(canRevise ? [{ value: "changes" as const, label: t("work.fb.changes"), icon: <PencilLine aria-hidden /> }] : []),
  ];

  return (
    <form ref={formRef} action={formAction} className="grid gap-2.5">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="deliverableId" value={deliverableId} />
      <input type="hidden" name="verdict" value={verdict ?? ""} />
      <LangField />
      <div
        role="radiogroup"
        aria-label={t("work.fb.title")}
        className="inline-flex w-fit rounded-md bg-secondary p-0.5"
      >
        {options.map((o) => {
          const on = verdict === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setVerdict(on ? null : o.value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium transition-colors duration-100 motion-reduce:transition-none [&_svg]:size-3.5",
                on ? "bg-background text-foreground shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.icon}
              {o.label}
            </button>
          );
        })}
      </div>
      {verdict && (
        <div ref={(el) => el?.scrollIntoView({ block: "nearest" })} className="grid gap-2 animate-in fade-in-0 duration-150">
          <Textarea
            name="note"
            rows={verdict === "changes" ? 3 : 2}
            required={verdict === "changes"}
            autoFocus
            placeholder={verdict === "changes" ? t("work.fb.placeholderRevise") : t("work.fb.placeholderGood")}
            className="min-h-16 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" loading={pending} disabled={pending}>
              {verdict === "changes" ? t("work.fb.sendBack") : t("work.fb.send")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setVerdict(null)} disabled={pending}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
