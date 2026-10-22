"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n";

type State = { state: "idle" | "starting" | "qr" | "linked" | "error"; qr?: string | null; message?: string };

/** Shows wacli's rotating QR code while linking; refreshes the page once linked. */
export function WhatsappQr({ businessId }: { businessId: string }) {
  const router = useRouter();
  const t = useT();
  const [s, setS] = useState<State>({ state: "idle" });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = (await (await fetch(`/api/b/${businessId}/whatsapp`, { cache: "no-store" })).json()) as State;
        if (stop) return;
        setS(r);
        if (r.state === "linked") router.refresh();
      } catch {
        // retry
      }
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [router, businessId]);

  if (s.state === "linked")
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-success">
        <CheckCircle2 className="size-4" />
        {t("profile.wa.linkedSyncingGroups")}
      </p>
    );
  if (s.state === "error") return <p className="text-sm text-destructive">{s.message}</p>;
  if (s.state !== "qr" || !s.qr)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-tertiary motion-reduce:animate-none" />
        {t("profile.wa.starting")}
      </p>
    );
  return (
    <div className="flex flex-wrap items-start gap-6 rounded-lg border border-border p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the API */}
      <img src={s.qr} alt={t("profile.wa.qrAlt")} width={200} height={200} className="size-[200px] shrink-0 bg-background" style={{ imageRendering: "pixelated" }} />
      <ol className="min-w-56 flex-1 list-decimal space-y-2 pl-5 text-sm leading-[22px] marker:text-tertiary">
        <li>{t("profile.wa.step1")}</li>
        <li>
          {t("profile.wa.step2Before")} <b className="font-semibold">{t("profile.wa.step2Path")}</b>.
        </li>
        <li>{t("profile.wa.step3")}</li>
      </ol>
    </div>
  );
}
