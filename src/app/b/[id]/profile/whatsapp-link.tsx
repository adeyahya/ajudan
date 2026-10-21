"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type State = { state: "idle" | "starting" | "qr" | "linked" | "error"; qr?: string | null; message?: string };

/** Shows wacli's rotating QR code while linking; refreshes the page once linked. */
export function WhatsappQr({ businessId }: { businessId: string }) {
  const router = useRouter();
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
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [router, businessId]);

  if (s.state === "linked") return <p className="font-pixel text-sm text-good">Linked! Syncing your groups…</p>;
  if (s.state === "error") return <p className="text-sm text-bad">{s.message}</p>;
  if (s.state !== "qr" || !s.qr) return <p className="text-sm text-muted-foreground pixel-caret">Starting WhatsApp link</p>;
  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the API */}
      <img src={s.qr} alt="WhatsApp link QR code" width={200} height={200} className="pixel-paper pixelated p-1" />
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>On the business phone, open WhatsApp.</li>
        <li>
          Go to <b>Settings → Linked devices → Link a device</b>.
        </li>
        <li>Scan this code. It refreshes every few seconds.</li>
      </ol>
    </div>
  );
}
