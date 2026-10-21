"use client";

import { useEffect, useRef } from "react";
import { buildSheet, lookFor, SPR_H, SPR_W } from "@/app/b/[id]/office/sprites";
import { cn } from "@/lib/utils";

/**
 * A teammate's chibi from the office, drawn as a framed pixel portrait.
 * `seed` picks the same hair/skin as in the office (use the teammate id).
 */
export function PixelPortrait({
  seed,
  color,
  size = 32,
  className,
  title,
}: {
  seed: string;
  color: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const frame = buildSheet(lookFor(seed, color)).frames.get("stand_down");
    if (!frame) return;
    // Head-and-shoulders crop, centered.
    const crop = { x: 0, y: 0, w: SPR_W, h: Math.min(SPR_H, 18) };
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 1, 2, crop.w, crop.h);
  }, [seed, color]);

  return (
    <span
      title={title}
      className={cn("pixel-frame relative inline-block shrink-0 overflow-hidden", className)}
      style={{
        width: size,
        height: size,
        margin: 3,
        background: `linear-gradient(${color}55, ${color}22)`,
      }}
    >
      <canvas ref={ref} width={20} height={20} className="pixelated absolute inset-0 size-full" aria-hidden />
    </span>
  );
}
