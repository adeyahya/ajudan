"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT, useTn } from "@/components/i18n";
import { Button, IconButton, StatusDot } from "@/components/kit";
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

  return (
    <section
      aria-label={t("chathome.office")}
      className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-[height] duration-300 ease-out motion-reduce:transition-none"
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
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-between gap-2", open ? "p-1.5" : "h-full px-1.5")}>
        <span
          className={cn(
            "pointer-events-auto inline-flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-[13px] leading-[18px]",
            open && "bg-background/90 shadow-(--elev-xs) backdrop-blur-sm",
          )}
        >
          <StatusDot state={working ? "working" : "idle"} />
          <span className="font-medium text-foreground">{t("chathome.office")}</span>
          <span className="truncate text-muted-foreground tabular-nums">
            {t("office.working", { count: working })}
            {state.pendingApprovals > 0 && ` · ${tn("office.needApproval", state.pendingApprovals)}`}
          </span>
        </span>
        <span className="pointer-events-auto flex shrink-0 items-center gap-1">
          <Button variant="secondary" size="sm" className={cn(open && "bg-background/90 backdrop-blur-sm")} asChild>
            <Link href={`/b/${businessId}/office`}>{t("chathome.openOffice")}</Link>
          </Button>
          <IconButton
            label={open ? t("chathome.minimise") : t("chathome.showOffice")}
            onClick={() => setStored(open ? "min" : "open")}
            aria-expanded={open}
            className={cn(open && "bg-background/90 backdrop-blur-sm hover:bg-background")}
          >
            {open ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
        </span>
      </div>
    </section>
  );
}
