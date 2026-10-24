"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT, useTn } from "@/components/i18n";
import { Button, Textarea } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { planTask } from "@/app/b/[id]/actions";
import { localizeError } from "@/components/workspace-ui";

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
  const t = useT();
  const tn = useTn();
  const [mate, setMate] = useState(teammates[0]?.id ?? "");
  const [text, setText] = useState(defaultText);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!teammates.length) return <p className="text-xs text-muted-foreground">{t("studio.plan.noTeam")}</p>;
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await planTask(businessId, mate, text, attachments);
          const res: { ok?: string; error?: string } = r;
          setError(localizeError(t, res.error) ?? null);
          if (res.ok) {
            toast(t("studio.plan.queued", { name: teammates.find((m) => m.id === mate)?.name ?? "" }));
            setText("");
            onDone?.();
          }
        });
      }}
    >
      <div className="text-[13px] leading-[18px] font-medium text-foreground">
        {attachments.length ? tn("studio.plan.titleFiles", attachments.length) : t("studio.plan.title")}
      </div>
      <Select value={mate} onValueChange={setMate}>
        <SelectTrigger size="sm" className="w-full" aria-label={t("studio.plan.teammate")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {teammates.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name} · {m.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t("studio.plan.placeholder")} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={pending || !text.trim()}>
          {pending ? t("studio.plan.queuing") : t("studio.plan.queue")}
        </Button>
      </div>
      <p className="text-xs text-tertiary">{t("studio.plan.restNote")}</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
