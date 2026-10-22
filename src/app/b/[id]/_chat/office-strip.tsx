"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT, useTn } from "@/components/i18n";
import { cn } from "@/lib/utils";
import { OfficeCanvas } from "../office/office-canvas";
import { layoutFor, TILE } from "../office/room";
import type { OfficeState } from "../office/state";
import { useIsDesktop, useOfficeLive } from "../office/use-office-live";
import { stripFit } from "./strip-fit";
import { useStored } from "./use-stored";

/** Height of the open strip, px. */
export const STRIP_H = 230;
/**
 * The living office above the chat: the real OfficeCanvas, cropped to a strip. Each
 * viewer can minimise it (remembered in localStorage). Phones don't mount the canvas.
 * Clicking someone opens their conversation.
 */
export function OfficeStrip({ businessId, businessName, initialState, initialNow }: { businessId: string; businessName: string; initialState: OfficeState; initialNow: number }) {
  const t = useT();
  const tn = useTn();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [stored, setStored] = useStored(`ajudan:office-strip:${businessId}`, "open");
  const open = stored !== "min";
  const { state, now, effects } = useOfficeLive(businessId, initialState, initialNow);
  const resting = !!state.rest && state.rest.until > now;
  const working = state.teammates.filter((m) => m.state === "working").length;

  const frameRef = useRef<HTMLDivElement>(null);
  const [frameW, setFrameW] = useState(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, isDesktop]);

  const L = useMemo(() => layoutFor(state.teammates.length), [state.teammates.length]);
  const fit = useMemo(() => {
    const W = L.W * TILE;
    const H = L.H * TILE;
    const first = L.desks[0];
    const last = L.desks.at(-1);
    const focus = first && last ? (first.dy * TILE + last.seatY) / 2 : H / 2;
    return stripFit(frameW, STRIP_H, W, H, focus);
  }, [L, frameW]);

  const openApprovals = useCallback(() => router.push(`/b/${businessId}/approvals`), [router, businessId]);
  const openChat = useCallback(
    (id: string | null) => {
      if (id && id !== state.managerId) router.push(`/b/${businessId}/teammates/${id}`);
    },
    [router, businessId, state.managerId],
  );

  if (!isDesktop || state.teammates.length === 0) return null;

  const button =
    "inline-flex items-center gap-1.5 rounded-md border border-frame bg-card/85 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm transition-colors hover:bg-card";

  return (
    <section
      aria-label={t("chathome.office")}
      className="pixel-panel relative shrink-0 overflow-hidden p-0 transition-[height] duration-300 ease-out motion-reduce:transition-none"
      style={{ height: open ? STRIP_H : 40 }}
    >
      {open ? (
        <div ref={frameRef} className="absolute inset-0 overflow-hidden bg-background">
          {frameW > 0 && (
            <div className="absolute" style={fit}>
              <OfficeCanvas
                businessName={businessName}
                teammates={state.teammates}
                pendingApprovals={state.pendingApprovals}
                deliverableCount={state.deliverableCount}
                resting={resting}
                effects={effects}
                selectedId={null}
                onSelect={openChat}
                onOpenApprovals={openApprovals}
              />
            </div>
          )}
        </div>
      ) : null}
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-between gap-2", open ? "p-2" : "h-full px-3")}>
        <span className={cn("pointer-events-auto inline-flex items-center gap-2 text-xs", open && "rounded-md border border-frame bg-card/85 px-2 py-1 backdrop-blur-sm")}>
          <span className={cn("size-2 rounded-full", working ? "animate-pulse bg-good" : "bg-muted-foreground/50")} />
          <span className="font-pixel">{t("chathome.office")}</span>
          <span className="text-muted-foreground tabular-nums">
            {t("office.working", { count: working })}
            {state.pendingApprovals > 0 && ` · ${tn("office.needApproval", state.pendingApprovals)}`}
          </span>
        </span>
        <span className="pointer-events-auto flex items-center gap-1.5">
          <Link href={`/b/${businessId}/office`} className={button}>
            {t("chathome.openOffice")}
          </Link>
          <button
            type="button"
            onClick={() => setStored(open ? "min" : "open")}
            aria-expanded={open}
            className={button}
            title={open ? t("chathome.minimise") : t("chathome.showOffice")}
          >
            {open ? <Minimize2 aria-hidden className="size-3.5" /> : <Maximize2 aria-hidden className="size-3.5" />}
            <span className="sr-only sm:not-sr-only">{open ? t("chathome.minimise") : t("chathome.showOffice")}</span>
          </button>
        </span>
      </div>
    </section>
  );
}
