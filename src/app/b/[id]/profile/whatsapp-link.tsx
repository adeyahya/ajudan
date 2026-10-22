"use client";

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

  if (s.state === "linked") return <p className="font-pixel text-sm text-good">{t("profile.wa.linkedSyncingGroups")}</p>;
  if (s.state === "error") return <p className="text-sm text-bad">{s.message}</p>;
  if (s.state !== "qr" || !s.qr) return <p className="text-sm text-muted-foreground pixel-caret">{t("profile.wa.starting")}</p>;
  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the API */}
      <img src={s.qr} alt={t("profile.wa.qrAlt")} width={200} height={200} className="pixel-paper pixelated p-1" />
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>{t("profile.wa.step1")}</li>
        <li>
          {t("profile.wa.step2Before")} <b>{t("profile.wa.step2Path")}</b>.
        </li>
        <li>{t("profile.wa.step3")}</li>
      </ol>
    </div>
  );
}
