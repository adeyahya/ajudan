"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, ConfirmDialog, IconButton } from "@/components/kit";
import { ObjectTypeIcon } from "@/components/object-type-icon";
import { typeLabel } from "@/components/workspace-labels";
import type { TrashType } from "@/lib/trash";
import { emptyTrashAction, purgeItem, restoreItem } from "./actions";

export type TrashRow = { type: TrashType; id: string; title: string; when: string; whenFull: string; who: string };

/** The Trash list: restore or delete each item forever. */
export function TrashList({ businessId, rows }: { businessId: string; rows: TrashRow[] }) {
  const t = useT();
  const [, start] = useTransition();
  const [shown, hide] = useOptimistic(rows, (cur, key: string) => cur.filter((r) => `${r.type}:${r.id}` !== key));

  const run = (r: TrashRow, kind: "restore" | "purge") =>
    start(async () => {
      hide(`${r.type}:${r.id}`);
      const res = kind === "restore" ? await restoreItem(businessId, r.type, r.id) : await purgeItem(businessId, r.type, r.id);
      if ("error" in res) toast.error(t("workspace.panel.failed"));
      else toast(t(kind === "restore" ? "workspace.trash.restored" : "workspace.trash.deleted"));
    });

  return (
    <ul className="divide-y divide-border border-y border-border">
      {shown.map((r) => (
        <li key={`${r.type}:${r.id}`} className="flex min-h-11 items-center gap-3 py-1.5">
          <ObjectTypeIcon type={r.type} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm leading-5 font-medium text-foreground">{r.title}</p>
            <p className="truncate text-xs text-tertiary">
              {typeLabel(t, r.type)} · <span title={r.whenFull}>{r.when}</span> · {r.who}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => run(r, "restore")}>
            <RotateCcw />
            {t("workspace.trash.restore")}
          </Button>
          <ConfirmDialog
            trigger={
              <IconButton label={t("workspace.trash.deleteForever")}>
                <Trash2 />
              </IconButton>
            }
            title={t("workspace.trash.deleteForeverTitle", { title: r.title })}
            body={t("workspace.trash.deleteForeverBody")}
            confirmLabel={t("workspace.trash.deleteForever")}
            cancelLabel={t("common.cancel")}
            destructive
            onConfirm={() => run(r, "purge")}
          />
        </li>
      ))}
    </ul>
  );
}

/** "Empty Trash", with a confirm. */
export function EmptyTrashButton({ businessId }: { businessId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="danger" disabled={pending}>
          {t("workspace.trash.emptyTrash")}
        </Button>
      }
      title={t("workspace.trash.emptyTrashTitle")}
      body={t("workspace.trash.emptyTrashBody")}
      confirmLabel={t("workspace.trash.emptyTrash")}
      cancelLabel={t("common.cancel")}
      destructive
      onConfirm={() =>
        start(async () => {
          await emptyTrashAction(businessId);
          toast(t("workspace.trash.emptied"));
        })
      }
    />
  );
}
