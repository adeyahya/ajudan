"use client";

import { Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { undoTeamChange } from "@/app/b/[id]/actions";
import { useT } from "@/components/i18n";
import { Button } from "@/components/kit";

/** Undo one teammate change (Inbox → Recent changes by the team). */
export function UndoChangeButton({ businessId, historyId }: { businessId: string; historyId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await undoTeamChange(businessId, historyId);
          if ("error" in r) toast.error(t("workspace.panel.failed"));
          else toast(t("workspace.undo.undone"));
        })
      }
    >
      <Undo2 />
      {t("workspace.undo.undo")}
    </Button>
  );
}
