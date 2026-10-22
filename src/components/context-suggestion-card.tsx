"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BookmarkPlusIcon } from "lucide-react";
import { useT } from "@/components/i18n";
import { Button, Prose } from "@/components/kit";
import { decideSuggestionAction } from "@/app/b/[id]/context/actions";

export type SuggestionCardData = {
  id: string;
  kind: "append" | "replace" | "new_page";
  body: string;
  status: "pending" | "accepted" | "rejected";
  pageId: string | null;
  /** The page it goes to, or the new page's title. */
  pageTitle: string;
};

/**
 * K5: a fact the owner stated in the chat, proposed for a Context page by the manager
 * (suggest_page_edit). Shows exactly what will be added where; Save accepts it, Edit
 * lets the owner change the text first.
 */
export function ContextSuggestionCard({ businessId, s }: { businessId: string; s: SuggestionCardData }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.body);
  const [pending, start] = useTransition();
  const decide = (accept: boolean) => start(async () => void (await decideSuggestionAction(businessId, s.id, accept, editing ? text : undefined)));
  const link = s.pageId ? `/b/${businessId}/context?page=${s.pageId}` : `/b/${businessId}/context`;
  if (s.status !== "pending") {
    return (
      <div className="flex w-full items-center gap-2 text-xs text-muted-foreground">
        <BookmarkPlusIcon className="size-3.5" />
        {s.status === "accepted" ? t("context.card.saved", { page: s.pageTitle }) : t("context.card.rejected")}
        {s.status === "accepted" && (
          <Link href={link} className="underline hover:text-foreground">
            {t("context.card.open")}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="w-full space-y-2 border-2 border-frame bg-secondary/60 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BookmarkPlusIcon className="size-4 text-primary" />
        {s.kind === "new_page" ? t("context.card.newPage", { title: s.pageTitle }) : t("context.card.title", { page: s.pageTitle })}
      </div>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full border border-border bg-background p-2 font-mono text-xs" />
      ) : (
        <div className="border-l-4 border-emerald-500 bg-emerald-500/10 px-3 py-1.5">
          <Prose className="text-sm">{s.body}</Prose>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" disabled={pending} onClick={() => decide(true)}>
          {t("context.card.save")}
        </Button>
        <Button size="xs" variant="secondary" disabled={pending} onClick={() => setEditing(!editing)}>
          {editing ? t("context.cancel") : t("context.card.edit")}
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => decide(false)}>
          {t("context.card.reject")}
        </Button>
        <Link href={link} className="ml-auto self-center text-xs text-muted-foreground hover:text-foreground">
          {t("context.card.open")}
        </Link>
      </div>
    </div>
  );
}
