"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT, useTn } from "@/components/i18n";
import { cn } from "@/components/kit";
import { OfficeEngine } from "./engine";
import { layoutFor, TILE } from "./room";
import type { OfficeTeammate } from "./state";
import { STATE_LABEL, type OfficeEffect } from "./types";

type Props = {
  businessName: string;
  teammates: OfficeTeammate[];
  pendingApprovals: number;
  deliverableCount: number;
  resting: boolean;
  effects: OfficeEffect[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenApprovals: () => void;
};

const TEXT = "clamp(9px, 1.3cqw, 12px)";

function shorten(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/**
 * The 2D pixel-art office: a canvas drawn by OfficeEngine at a fixed internal resolution and scaled up
 * with nearest-neighbour, plus a DOM overlay for crisp text (name tags, bubbles, whiteboard title).
 */
export function OfficeCanvas({
  businessName,
  teammates,
  pendingApprovals,
  deliverableCount,
  resting,
  effects,
  selectedId,
  onSelect,
  onOpenApprovals,
}: Props) {
  const tr = useT();
  const tn = useTn();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const tagRefs = useRef(new Map<string, HTMLDivElement>());
  const bubbleRefs = useRef(new Map<string, HTMLElement>());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const L = useMemo(() => layoutFor(teammates.length), [teammates.length]);
  const WW = L.W * TILE;
  const HH = L.H * TILE;

  // Latest props for the engine, read inside the long-lived effect.
  const latest = useRef({ teammates, pendingApprovals, deliverableCount, resting, selectedId });
  useEffect(() => {
    latest.current = { teammates, pendingApprovals, deliverableCount, resting, selectedId };
    engineRef.current?.sync(teammates, pendingApprovals, deliverableCount, resting);
  }, [teammates, pendingApprovals, deliverableCount, resting, selectedId]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    for (const e of effects) eng.pushEffect(e);
  }, [effects]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.selectedId = selectedId;
  }, [selectedId]);

  // Engine + render loop. Created once; paused while the tab is hidden.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const { teammates: tms, pendingApprovals: pa, deliverableCount: dc, resting: rs } = latest.current;
    const eng = new OfficeEngine(tms.length);
    eng.sync(tms, pa, dc, rs);
    eng.selectedId = latest.current.selectedId;
    engineRef.current = eng;
    const ctx = canvas.getContext("2d")!;

    const blit = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(eng.world, 0, 0, canvas.width, canvas.height);
    };
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        blit(); // resizing clears the canvas; repaint even if the loop is paused
      }
    };
    eng.render();
    fit();
    blit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);

    const place = () => {
      const W = eng.L.W * TILE;
      const H = eng.L.H * TILE;
      for (const a of eng.anchors()) {
        const tag = tagRefs.current.get(a.id);
        if (tag) {
          tag.style.left = `${(a.x / W) * 100}%`;
          tag.style.top = `${((a.feet + 1) / H) * 100}%`;
        }
        const b = bubbleRefs.current.get(a.id);
        if (b) {
          const y = a.home ? a.bubbleY : a.top - 2;
          b.style.left = `${(a.x / W) * 100}%`;
          b.style.top = `${(y / H) * 100}%`;
        }
      }
    };

    let raf = 0;
    let last = 0;
    let running = false;
    const frame = (ts: number) => {
      const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
      last = ts;
      eng.update(dt);
      eng.render();
      blit();
      place();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    place();
    if (!document.hidden) start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      engineRef.current = null;
    };
  }, []);

  const toWorld = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * WW, y: ((e.clientY - r.top) / r.height) * HH };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current;
    if (!eng) return;
    const p = toWorld(e);
    const hit = eng.hitTest(p.x, p.y);
    if (hit !== eng.hoverId) {
      eng.hoverId = hit;
      setHoverId(hit);
    }
  };
  const onLeave = () => {
    if (engineRef.current) engineRef.current.hoverId = null;
    setHoverId(null);
  };
  const onClick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const eng = engineRef.current;
    if (!eng) return;
    const p = toWorld(e);
    const hit = eng.hitTest(p.x, p.y);
    if (!hit && eng.pet(p.x, p.y)) return;
    onSelect(hit);
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const wb = L.whiteboard;
  const o = L.owner;
  const bubbleBase =
    "absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[4px] border-2 border-[#2a1d22] shadow-[2px_2px_0_rgba(42,29,34,0.25)] font-semibold leading-none";

  return (
    <div ref={wrapRef} className="absolute inset-0 select-none" style={{ containerType: "inline-size" }}>
      <canvas
        ref={canvasRef}
        className={cn("absolute inset-0 h-full w-full [image-rendering:pixelated]", hoverId ? "cursor-pointer" : "cursor-default")}
        role="img"
        aria-label={tr("office.canvasLabel", { business: businessName, people: teammates.map((t) => tr("office.personState", { name: t.name, state: tr(STATE_LABEL[t.state]) })).join(", ") })}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onClick={onClick}
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ fontSize: TEXT }}>
        {/* Whiteboard title */}
        <div
          className="absolute flex items-start justify-center overflow-hidden px-[1%] pt-[0.4%] text-center font-bold leading-tight text-[#1e3a8a]"
          style={{
            left: pct(wb.x, WW),
            top: pct(wb.y, HH),
            width: pct(wb.w, WW),
            height: pct(wb.h - 14, HH),
            fontFamily: '"Chalkboard SE", "Comic Sans MS", "Marker Felt", ui-rounded, system-ui, sans-serif',
            fontSize: "clamp(9px, 1.45cqw, 14px)",
          }}
        >
          <span className="line-clamp-2 break-words">{businessName}</span>
        </div>

        {/* Owner desk: name tag + inbox */}
        <div
          className="absolute -translate-x-1/2 rounded-full bg-[#2a1d22]/75 px-[0.6em] py-[0.25em] font-medium leading-none text-white"
          style={{ left: pct(o.seatX + 8, WW), top: pct((o.dy + 1) * TILE + 1, HH) }}
        >
          {tr("office.you")}
        </div>
        {pendingApprovals > 0 && (
          <button
            type="button"
            onClick={onOpenApprovals}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full cursor-pointer rounded-full border-2 border-[#2a1d22] bg-amber-400 px-[0.5em] py-[0.15em] font-bold leading-none text-[#2a1d22] shadow-[2px_2px_0_rgba(42,29,34,0.25)] hover:bg-amber-300"
            style={{ left: pct(o.dx * TILE + 40, WW), top: pct(o.dy * TILE - 6, HH) }}
            aria-label={tn("office.pendingApprovals", pendingApprovals)}
          >
            {tr("office.toReview", { count: pendingApprovals })}
          </button>
        )}

        {teammates.map((t, i) => {
          const active = hoverId === t.id || selectedId === t.id;
          const seat = L.desks[i];
          const tagPos = seat ? { left: pct(seat.seatX, WW), top: pct(seat.seatY + 1, HH) } : undefined;
          const bubblePos = seat ? { left: pct(seat.seatX, WW), top: pct(seat.dy * TILE - 10, HH) } : undefined;
          return (
            <div key={t.id}>
              <div
                ref={(el) => {
                  if (el) tagRefs.current.set(t.id, el);
                  else tagRefs.current.delete(t.id);
                }}
                className={cn(
                  "absolute -translate-x-1/2 inline-flex items-center gap-[0.35em] rounded-full px-[0.6em] py-[0.25em] font-medium leading-none text-white transition-colors",
                  active ? "z-40" : "z-[15] bg-[#2a1d22]/75",
                )}
                style={{ ...tagPos, ...(active ? { background: t.color } : null) }}
              >
                <span
                  className="inline-block size-[0.55em] rounded-full ring-1 ring-white/70"
                  style={{ background: t.state === "working" ? "#4ade80" : t.state === "waiting" ? "#fbbf24" : t.state === "error" ? "#f87171" : "#cbd5e1" }}
                />
                {t.name}
              </div>
              {t.state === "working" && (
                <div
                  ref={(el) => {
                    if (el) bubbleRefs.current.set(t.id, el);
                    else bubbleRefs.current.delete(t.id);
                  }}
                  data-state="working"
                  style={bubblePos}
                  className={cn(
                    bubbleBase,
                    "z-10 w-max whitespace-normal bg-white px-[0.5em] py-[0.35em] text-center leading-[1.15] text-[#2a1d22]",
                    active ? "z-30 max-w-[26cqw]" : "max-w-[13cqw]",
                  )}
                >
                  <span className="line-clamp-2">{t.currentActivity ? shorten(t.currentActivity, active ? 64 : 34) : "…"}</span>
                  <span className="absolute left-1/2 top-full -ml-[3px] size-0 border-x-[3px] border-t-[4px] border-x-transparent border-t-[#2a1d22]" />
                </div>
              )}
              {t.state === "waiting" && (
                <button
                  type="button"
                  ref={(el) => {
                    if (el) bubbleRefs.current.set(t.id, el);
                    else bubbleRefs.current.delete(t.id);
                  }}
                  data-state="waiting"
                  style={bubblePos}
                  onClick={onOpenApprovals}
                  title={tr("office.needsYourApproval", { name: t.name })}
                  aria-label={tr("office.needsYourApproval", { name: t.name })}
                  className={cn(bubbleBase, "pointer-events-auto z-20 cursor-pointer bg-transparent p-0 border-0 shadow-none")}
                >
                  <span className="block animate-bounce rounded-[4px] border-2 border-[#2a1d22] bg-amber-400 px-[0.55em] py-[0.3em] text-[1.25em] font-black text-[#2a1d22] shadow-[2px_2px_0_rgba(42,29,34,0.25)] hover:bg-amber-300">
                    !
                  </span>
                </button>
              )}
              {t.state === "error" && (
                <div
                  ref={(el) => {
                    if (el) bubbleRefs.current.set(t.id, el);
                    else bubbleRefs.current.delete(t.id);
                  }}
                  data-state="error"
                  style={bubblePos}
                  className={cn(bubbleBase, "z-10 bg-red-500 px-[0.45em] py-[0.3em] text-[1.1em] text-white")}
                  title={t.currentActivity ?? tr("office.somethingWrong")}
                >
                  ⚠
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
