"use client";

import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { IconButton } from "@/components/kit";
import { useShortcut } from "@/components/shortcuts";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Notion's side peek (UI-PLAN §2.5): a record opens on the right without leaving the list.
 *
 * ≥1024px: an inline, non-modal pane (420px, resizable 360–960, remembered in
 * localStorage `ajudan:peek:w`), sticky under the top bar, sliding in over 220ms; the main
 * column keeps its own width. <1024px: a right Sheet (92vw, max 480px). Esc closes.
 *
 *   const peek = useUrlPeek("d");                         // ?d=<id> keeps it across reloads
 *   <SidePeekLayout
 *     peek={
 *       <SidePeek open={!!peek.value} onClose={peek.close} title={row?.title} openHref={…} actions={…}>
 *         …details…
 *       </SidePeek>
 *     }
 *   >
 *     <PageBody width="wide">…table rows call peek.open(row.id)…</PageBody>
 *   </SidePeekLayout>
 *
 * useUrlPeek reads useSearchParams, so the component using it must sit inside <Suspense>
 * (pages already wrap their content in one).
 */

const W_KEY = "ajudan:peek:w";
const W_DEFAULT = 420;
const W_MIN = 360;
const W_MAX = 960;

const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** ≥1024px (true during server render, so the inline pane is what's prerendered). */
export function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

/** A search param as the peek's open record: `open(id)` sets it, `close()` removes it. */
export function useUrlPeek(param: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get(param);
  const set = useCallback(
    (v: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (v) next.set(param, v);
      else next.delete(param);
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, param, pathname, router],
  );
  return { value, open: (id: string) => set(id), close: () => set(null) };
}

/** Main column + the peek pane side by side (the pane only takes room when open, ≥1024px). */
export function SidePeekLayout({ peek, children, className }: { peek: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-start", className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {peek}
    </div>
  );
}

export function SidePeek({
  open,
  onClose,
  title,
  description,
  openHref,
  actions,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Shown in the 44px header (a short label; the body can carry the big title). */
  title?: ReactNode;
  /** For screen readers on the phone sheet. */
  description?: string;
  /** "Open as page" (Maximize2) when the record has its own page. */
  openHref?: string;
  /** Extra header buttons (IconButtons, a "…" menu), left of Open/Close. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const desktop = useIsDesktop();
  useShortcut("escape", onClose, { enabled: open && desktop, allowInInputs: true });

  const header = (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
      <div className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium text-muted-foreground">{title}</div>
      {actions}
      {openHref && (
        <IconButton label={t("peek.openAsPage")} asChild>
          <Link href={openHref}>
            <Maximize2 />
          </Link>
        </IconButton>
      )}
      <IconButton label={t("common.close")} shortcut="Esc" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );

  if (!desktop) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" showCloseButton={false} className="w-[92vw] max-w-[480px] gap-0 p-0 sm:max-w-[480px]">
          <SheetTitle className="sr-only">{typeof title === "string" ? title : t("peek.openAsPage")}</SheetTitle>
          <SheetDescription className="sr-only">{description ?? ""}</SheetDescription>
          {header}
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-5", className)}>{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return <InlinePeek header={header} className={className}>{children}</InlinePeek>;
}

function InlinePeek({ header, className, children }: { header: ReactNode; className?: string; children: ReactNode }) {
  const t = useT();
  const [width, setWidth] = useState(W_DEFAULT);
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(W_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage after mount
      if (w >= W_MIN && w <= W_MAX) setWidth(w);
    } catch {}
  }, []);
  const save = (w: number) => {
    try {
      localStorage.setItem(W_KEY, String(w));
    } catch {}
  };

  return (
    <aside
      className="sticky top-(--topbar-h) z-10 hidden h-[calc(100dvh-var(--topbar-h))] shrink-0 border-l border-border bg-background duration-220 ease-(--ease) animate-in slide-in-from-right-8 fade-in-0 lg:flex lg:flex-col"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("peek.resize")}
        title={t("peek.resize")}
        tabIndex={-1}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // Never so wide the page beside it has no room.
          setWidth(Math.min(W_MAX, window.innerWidth - 480, Math.max(W_MIN, drag.current.w + (drag.current.x - e.clientX))));
        }}
        onPointerUp={() => {
          drag.current = null;
          save(width);
        }}
        onDoubleClick={() => {
          setWidth(W_DEFAULT);
          save(W_DEFAULT);
        }}
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
      >
        <span className="absolute inset-y-0 left-1 w-px bg-transparent transition-colors duration-100 group-hover:bg-border-strong group-active:bg-ring" />
      </div>
      {header}
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)}>{children}</div>
    </aside>
  );
}
