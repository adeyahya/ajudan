"use client";

import { Check, X } from "lucide-react";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Avatar, Badge, Button, Input, Kbd, Label, cn } from "@/components/kit";
import { useShortcut } from "@/components/shortcuts";
import { approveCapability, decideApproval, rejectCapability } from "./actions";
import { KIND_META, type ApprovalKind } from "./kinds";

export type InboxCard = {
  id: string;
  summary: string;
  teammate?: { id: string; name: string; color: string; title: string };
  /** "5 min ago" and the full timestamp (rendered on the server). */
  when: string;
  whenFull: string;
  kind: ApprovalKind;
  /** What the teammate wants to do (server-rendered typed preview). */
  preview: ReactNode;
  /** A request_capability approval; `secret` when the owner has to paste a credential. */
  capability?: { secret?: { name: string; hosts: string[] } };
};

/**
 * "Needs you": one card per pending approval. Keyboard: j/k move, a approve, r reject,
 * n focus the note. A decision removes the card at once (useOptimistic) and toasts; if the
 * server refuses (already decided, missing credential) the card comes back with an error toast.
 */
export function InboxList({ businessId, cards, empty }: { businessId: string; cards: InboxCard[]; empty: ReactNode }) {
  const t = useT();
  const [items, removeItem] = useOptimistic(cards, (s, id: string) => s.filter((c) => c.id !== id));
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const forms = useRef(new Map<string, HTMLFormElement>());

  const activeIndex = Math.max(0, items.findIndex((c) => c.id === activeId));
  const active = items[activeIndex];

  const focusCard = (i: number) => {
    const c = items[Math.min(items.length - 1, Math.max(0, i))];
    if (!c) return;
    setActiveId(c.id);
    forms.current.get(c.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const decide = (card: InboxCard, decision: "approved" | "rejected") => {
    const form = forms.current.get(card.id);
    const fd = form ? new FormData(form) : new FormData();
    fd.set("businessId", businessId);
    fd.set("approvalId", card.id);
    fd.set("decision", decision);
    // Keep the cursor on the same slot: the next card moves up into it.
    const next = items[activeIndex + 1] ?? items[activeIndex - 1];
    if (card.id === active?.id) setActiveId(next?.id ?? null);
    startTransition(async () => {
      removeItem(card.id);
      let error: string | undefined;
      try {
        if (card.capability && decision === "approved") error = (await approveCapability(businessId, card.id, {}, fd)).error;
        else if (card.capability) await rejectCapability(businessId, card.id, fd);
        else error = (await decideApproval(fd)).error;
      } catch (err) {
        error = (err as Error).message;
      }
      if (error) toast.error(error);
      else toast.success(t(decision === "approved" ? "approvals.toast.approved" : "approvals.toast.rejected", { summary: card.summary }));
    });
  };

  const enabled = items.length > 0;
  useShortcut("j", () => focusCard(activeIndex + 1), { enabled });
  useShortcut("k", () => focusCard(activeIndex - 1), { enabled });
  // "a" submits the form so a credential field's `required` check still runs.
  useShortcut("a", () => active && forms.current.get(active.id)?.requestSubmit(), { enabled });
  useShortcut("r", () => active && decide(active, "rejected"), { enabled });
  useShortcut(
    "n",
    (e) => {
      if (!active) return;
      e.preventDefault();
      forms.current.get(active.id)?.querySelector<HTMLInputElement>("input[name=note]")?.focus();
    },
    { enabled },
  );

  if (!items.length) return <>{empty}</>;
  return (
    <div className="space-y-3">
      <div aria-label={t("approvals.keys.label")} className="hidden items-center gap-3 text-xs text-tertiary md:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd>j</Kbd>
          <Kbd>k</Kbd>
          {t("approvals.keys.move")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>a</Kbd>
          {t("approvals.approve")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>r</Kbd>
          {t("approvals.reject")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>n</Kbd>
          {t("approvals.keys.note")}
        </span>
      </div>
      <ul className="space-y-3">
        {items.map((card) => {
          const isActive = card.id === active?.id;
          const meta = KIND_META[card.kind];
          const Icon = meta.icon;
          return (
            <li key={card.id}>
              <form
                ref={(el) => {
                  if (el) forms.current.set(card.id, el);
                  else forms.current.delete(card.id);
                }}
                autoComplete="off"
                aria-label={card.summary}
                onSubmit={(e) => {
                  e.preventDefault();
                  decide(card, "approved");
                }}
                onFocusCapture={() => setActiveId(card.id)}
                onPointerDown={() => setActiveId(card.id)}
                className={cn(
                  "scroll-mt-16 space-y-3 rounded-lg border bg-background p-4 transition-[border-color,box-shadow] duration-100 motion-reduce:transition-none",
                  isActive ? "border-ring/50 shadow-[0_0_0_1px_color-mix(in_oklab,var(--ring)_25%,transparent)]" : "border-border",
                )}
              >
                <div className="flex items-center gap-2">
                  {card.teammate && <Avatar seed={card.teammate.id} name={card.teammate.name} color={card.teammate.color} size={24} />}
                  <div className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-foreground">
                    {card.teammate?.name}
                    {card.teammate?.title && <span className="font-normal text-tertiary"> · {card.teammate.title}</span>}
                  </div>
                  <Badge tone={meta.tone}>
                    <Icon aria-hidden />
                    {t(meta.label)}
                  </Badge>
                  <time className="shrink-0 text-xs text-tertiary" title={card.whenFull}>
                    {card.when}
                  </time>
                </div>
                <p className="text-sm leading-[22px] font-semibold text-foreground [overflow-wrap:anywhere]">{card.summary}</p>
                {card.preview}
                {card.capability?.secret && (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`secret-${card.id}`}>
                      {t("approvals.secretValueOf")} <code className="font-mono text-xs">{card.capability.secret.name}</code>{" "}
                      <span className="font-normal text-muted-foreground">
                        {t("approvals.secretOnlyTo", { hosts: card.capability.secret.hosts.join(", ") })}
                      </span>
                    </Label>
                    <Input
                      id={`secret-${card.id}`}
                      name="value"
                      type="password"
                      required
                      inputSize="sm"
                      autoComplete="new-password"
                      placeholder={t("approvals.secretPlaceholder")}
                    />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Input
                    name="note"
                    inputSize="sm"
                    placeholder={t("approvals.notePlaceholder")}
                    className="min-w-0 flex-1 basis-48"
                    onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
                  />
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm">
                      <Check aria-hidden />
                      {card.capability?.secret ? t("approvals.saveApprove") : t("approvals.approve")}
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => decide(card, "rejected")}>
                      <X aria-hidden />
                      {t("approvals.reject")}
                    </Button>
                  </div>
                </div>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
