"use client";

import { useState, useTransition } from "react";
import { Button, Textarea } from "@/components/kit";
import { planTask } from "../actions";

export type MateOption = { id: string; name: string; title: string };

/** "Give this to a teammate": queued now, done when the team has usage again. */
export function PlanTask({
  businessId,
  teammates,
  attachments,
  defaultText = "",
  onDone,
}: {
  businessId: string;
  teammates: MateOption[];
  attachments: string[];
  defaultText?: string;
  onDone?: () => void;
}) {
  const [mate, setMate] = useState(teammates[0]?.id ?? "");
  const [text, setText] = useState(defaultText);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  if (!teammates.length) return <p className="text-xs text-muted-foreground">Hire a team first to hand work over.</p>;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await planTask(businessId, mate, text, attachments);
          setMsg(r);
          if (r.ok) {
            setText("");
            onDone?.();
          }
        });
      }}
    >
      <div className="text-xs font-medium">Plan a task with {attachments.length ? `${attachments.length} file${attachments.length === 1 ? "" : "s"}` : "this"}</div>
      <select value={mate} onChange={(e) => setMate(e.target.value)} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm">
        {teammates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · {t.title}
          </option>
        ))}
      </select>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. Make a 15s reel for the payday promo from these clips" />
      <Button type="submit" size="sm" disabled={pending || !text.trim()}>
        {pending ? "Queuing…" : "Queue for the team"}
      </Button>
      <p className="text-[11px] text-muted-foreground">If the team is resting, it waits in the queue and starts when they&apos;re back.</p>
      {msg?.ok && <p className="text-xs text-emerald-600 dark:text-emerald-400">{msg.ok}</p>}
      {msg?.error && <p className="text-xs text-red-600 dark:text-red-400">{msg.error}</p>}
    </form>
  );
}
