"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { BookmarkPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, Prose, Textarea } from "@/components/kit";
import { decideSuggestionAction } from "@/app/b/[id]/context/actions";
import type { SuggestionKind } from "@/db/schema";

export type SuggestionCardData = {
  id: string;
  kind: SuggestionKind;
  body: string;
  status: "pending" | "accepted" | "rejected";
  pageId: string | null;
  /** The page it goes to, or the new page's title. */
  pageTitle: string;
};

/**
 * K5: a fact the owner stated in the chat, proposed for a Context page by the manager
 * (suggest_page_edit). Shows exactly what will be added where; Save accepts it, Edit lets
 * the owner change the text first. The decision shows at once (useOptimistic) and the card
 * folds into a one-line note; a failed save puts the card back with a toast.
 */
export function ContextSuggestionCard({ businessId, s }: { businessId: string; s: SuggestionCardData }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.body);
  const [status, setStatus] = useOptimistic(s.status);
  const [, start] = useTransition();
  const decide = (accept: boolean) =>
    start(async () => {
      setStatus(accept ? "accepted" : "rejected");
      const r = await decideSuggestionAction(businessId, s.id, accept, editing ? text : undefined);
      if ("error" in r && r.error) toast.error(t("chat.card.failed"));
    });
  const link = s.pageId ? `/b/${businessId}/context?page=${s.pageId}` : `/b/${businessId}/context`;

  if (status !== "pending") {
    return (
      <div className="flex w-full items-center gap-1.5 text-xs text-tertiary">
        <BookmarkPlusIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{status === "accepted" ? t("context.card.saved", { page: s.pageTitle }) : t("context.card.rejected")}</span>
        {status === "accepted" && (
          <Link href={link} className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {t("context.card.open")}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="w-full max-w-xl space-y-2.5 rounded-lg border border-border bg-background p-3">
      <div className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] font-medium text-foreground">
        <BookmarkPlusIcon aria-hidden className="size-4 shrink-0 text-primary" strokeWidth={1.75} />
        <span className="min-w-0 truncate">
          {s.kind === "new_page" ? t("chat.card.newPage", { title: s.pageTitle }) : t("chat.card.saveTo", { page: s.pageTitle })}
        </span>
        <Link href={link} className="ml-auto shrink-0 rounded-sm text-xs font-normal text-tertiary hover:text-foreground">
          {t("context.card.open")}
        </Link>
      </div>
      {editing ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus className="min-h-24 text-[13px]" aria-label={t("context.card.edit")} />
      ) : (
        <div className="border-l-2 border-border-strong pl-3 text-[13px] text-muted-foreground [&_p]:text-[13px] [&_p]:leading-5">
          <Prose>{s.body}</Prose>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" onClick={() => decide(true)}>
          {t("context.card.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? t("context.cancel") : t("context.card.edit")}
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => decide(false)}>
          {t("context.card.reject")}
        </Button>
      </div>
    </div>
  );
}
