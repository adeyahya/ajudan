"use client";

import { Check } from "lucide-react";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/kit";
import { useT } from "@/components/i18n";
import { SidePeek, useUrlPeek } from "@/components/side-peek";
import { markPosted } from "./actions";

/**
 * The Work page's side peek (`?d=<deliverableId>`; search results link here). The body is
 * rendered on the server and passed in; this only owns open/close (Esc, X, the phone sheet).
 */
export function DeliverablePeek({ open, title, children }: { open: boolean; title?: string; children: ReactNode }) {
  const peek = useUrlPeek("d");
  return (
    <SidePeek open={open} onClose={peek.close} title={title}>
      {children}
    </SidePeek>
  );
}

/** "Mark posted" / "Mark sent": the owner posted it themselves. Toasts when done. */
export function MarkPostedButton({
  businessId,
  deliverableId,
  title,
  isMessage,
}: {
  businessId: string;
  deliverableId: string;
  title: string;
  isMessage: boolean;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      loading={pending}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("businessId", businessId);
          fd.set("deliverableId", deliverableId);
          try {
            await markPosted(fd);
            toast.success(t(isMessage ? "work.toast.sent" : "work.toast.posted", { title }));
          } catch (err) {
            toast.error((err as Error).message);
          }
        })
      }
    >
      <Check aria-hidden />
      {isMessage ? t("work.markSent") : t("work.markPosted")}
    </Button>
  );
}
