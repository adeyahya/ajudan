"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Badge, Button, cn } from "@/components/kit";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Edit } from "@/db/schema";
import type { MessageKey } from "@/lib/i18n";
import { deleteEdit } from "../actions";
import { DeleteDialog, MoreMenu } from "./studio-shell";

const TONE = { draft: "gray", queued: "blue", rendering: "yellow", done: "green", failed: "red" } as const;
const LABEL: Record<Edit["status"], MessageKey> = {
  draft: "studio.edit.status.draft",
  queued: "studio.edit.status.queued",
  rendering: "studio.edit.status.rendering",
  done: "studio.edit.status.done",
  failed: "studio.edit.status.failed",
};

export const fileUrl = (businessId: string, rel: string) => `/api/b/${businessId}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

export function StatusBadge({ status }: { status: Edit["status"] }) {
  const t = useT();
  return <Badge tone={TONE[status]}>{t(LABEL[status])}</Badge>;
}

/** Saved edits of one kind: open, see their render status, delete. */
export function EditsList({ businessId, edits, kind, currentId }: { businessId: string; edits: Edit[]; kind: Edit["kind"]; currentId?: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<Edit | null>(null);
  const base = `/b/${businessId}/studio/${kind}`;
  return (
    <section>
      <div className="mb-1 flex h-7 items-center justify-between gap-2">
        <h3 className="truncate text-[13px] leading-[18px] font-medium text-tertiary">{t(kind === "video" ? "studio.edits.video" : "studio.edits.audio")}</h3>
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link href={base}>
            <Plus /> {t("studio.edits.new")}
          </Link>
        </Button>
      </div>
      {edits.length === 0 && <p className="py-1 text-xs text-tertiary">{t("studio.edits.empty")}</p>}
      <ul>
        {edits.map((e) => (
          <li
            key={e.id}
            className={cn(
              "group/edit flex h-8 items-center gap-2 rounded-md pr-0.5 pl-2 transition-colors duration-100 hover:bg-hover",
              e.id === currentId && "bg-accent",
            )}
          >
            <Link href={`${base}?edit=${e.id}`} className="min-w-0 flex-1 truncate rounded-sm text-[13px] leading-[18px] text-foreground" title={e.title}>
              {e.title}
            </Link>
            <StatusBadge status={e.status} />
            <MoreMenu
              label={t("studio.more")}
              size="icon-xs"
              disabled={pending}
              className="opacity-0 group-hover/edit:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            >
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(e)}>
                <Trash2 /> {t("common.delete")}
              </DropdownMenuItem>
            </MoreMenu>
          </li>
        ))}
      </ul>
      <DeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("studio.edits.deleteTitle", { title: deleting?.title ?? "" })}
        body={t("studio.edits.deleteBody")}
        onConfirm={() => {
          const e = deleting;
          setDeleting(null);
          if (!e) return;
          start(async () => {
            await deleteEdit(businessId, e.id);
            toast(t("studio.edits.deleted"));
          });
        }}
      />
    </section>
  );
}

/** Where the current edit stands, and its last render. */
export function RenderResult({ businessId, edit }: { businessId: string; edit?: Edit }) {
  const t = useT();
  if (!edit) return null;
  return (
    <div className="space-y-1.5 text-[13px] leading-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={edit.status} />
        {edit.status === "queued" && <span className="text-xs text-tertiary">{t("studio.render.queued")}</span>}
        {edit.status === "rendering" && <span className="text-xs text-tertiary">{t("studio.render.rendering")}</span>}
      </div>
      {edit.status === "failed" && edit.error && <p className="text-xs break-words text-destructive">{edit.error}</p>}
      {edit.output && (
        <p className="text-xs text-muted-foreground">
          {t("studio.render.last")}{" "}
          <a href={fileUrl(businessId, edit.output)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {edit.output.replace(/^media\//, "")}
          </a>{" "}
          ·{" "}
          <Link href={`/b/${businessId}/studio`} className="text-primary hover:underline">
            {t("studio.render.inLibrary")}
          </Link>
        </p>
      )}
    </div>
  );
}
