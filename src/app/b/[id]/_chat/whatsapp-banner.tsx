"use client";

import { MessageCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/components/i18n";
import { Button, IconButton } from "@/components/kit";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useStored } from "./use-stored";

/**
 * Until the owner is a person on the team, a dismissible 36px row above the chat offers
 * the WhatsApp setup; "Set up" opens the three steps (children: the server-rendered
 * WhatsappChecklist) in a dialog. Dismissing is per viewer (localStorage).
 */
export function WhatsappBanner({ businessId, children }: { businessId: string; children: ReactNode }) {
  const t = useT();
  const [state, setState] = useStored(`ajudan:wa-banner:${businessId}`, "open");
  if (state === "dismissed") return null;
  return (
    <Dialog>
      <div className="flex h-9 shrink-0 items-center gap-2 rounded-md bg-muted pr-1 pl-3 text-[13px] leading-[18px]">
        <MessageCircle aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-foreground">{t("chathome.waBanner")}</span>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm" className="h-7 bg-background">
            {t("chathome.waSetUp")}
          </Button>
        </DialogTrigger>
        <IconButton label={t("chathome.waDismiss")} onClick={() => setState("dismissed")}>
          <X />
        </IconButton>
      </div>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("manager.wa.title")}</DialogTitle>
          <DialogDescription>{t("manager.wa.subtitle")}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
