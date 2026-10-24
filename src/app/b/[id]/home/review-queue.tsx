"use client";

import { Check, Trash2 } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Avatar, Button, IconButton } from "@/components/kit";
import { ObjectTypeIcon } from "@/components/object-type-icon";
import { typeLabel } from "@/components/workspace-labels";
import type { ObjectType } from "@/db/schema";
import { keepNewItem, markAllNewSeen, trashNewItem } from "./actions";

export type ReviewItem = {
  type: ObjectType;
  id: string;
  title: string;
  href: string;
  who: string;
  teammateId?: string;
  color?: string;
  when: string;
  whenFull: string;
};

/** "New from the team" on Home: open, keep (dismiss) or move to Trash what teammates made. */
export function ReviewQueue({ businessId, items }: { businessId: string; items: ReviewItem[] }) {
  const t = useT();
  const [, start] = useTransition();
  const [shown, hide] = useOptimistic(items, (cur, key: string) => (key === "*" ? [] : cur.filter((i) => `${i.type}:${i.id}` !== key)));

  const act = (item: ReviewItem, kind: "keep" | "trash") =>
    start(async () => {
      hide(`${item.type}:${item.id}`);
      const ref = { type: item.type, id: item.id };
      const r = kind === "keep" ? await keepNewItem(businessId, ref) : await trashNewItem(businessId, ref);
      if ("error" in r) toast.error(t("workspace.panel.failed"));
      else toast(t(kind === "keep" ? "workspace.home.keepToast" : "workspace.home.movedToTrash"));
    });

  if (shown.length === 0) return <p className="py-2 text-[13px] text-tertiary">{t("workspace.home.newEmpty")}</p>;
  return (
    <>
      <ul className="divide-y divide-border border-y border-border">
        {shown.map((i) => (
          <li key={`${i.type}:${i.id}`} className="group flex min-h-11 items-center gap-3 py-1.5">
            <ObjectTypeIcon type={i.type} />
            <div className="min-w-0 flex-1">
              <Link href={i.href} className="block truncate text-sm leading-5 font-medium text-foreground hover:underline">
                {i.title}
              </Link>
              <p className="flex items-center gap-1.5 truncate text-xs text-tertiary">
                {i.teammateId && i.color && <Avatar seed={i.teammateId} name={i.who} color={i.color} size={16} />}
                <span className="truncate">
                  {i.who} · {typeLabel(t, i.type)} · <span title={i.whenFull}>{i.when}</span>
                </span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild size="sm" variant="ghost">
                <Link href={i.href}>{t("common.open")}</Link>
              </Button>
              <Button size="sm" variant="secondary" onClick={() => act(i, "keep")}>
                <Check />
                {t("workspace.home.keep")}
              </Button>
              <IconButton label={t("workspace.home.moveToTrash")} onClick={() => act(i, "trash")}>
                <Trash2 />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() =>
            start(async () => {
              hide("*");
              await markAllNewSeen(businessId);
            })
          }
        >
          {t("workspace.home.markAllSeen")}
        </Button>
      </div>
    </>
  );
}
