/** The room is drawn at most this many times the strip's height; the rest is cropped top and bottom. */
export const MAX_OVERSCAN = 1.75;

/**
 * Where the room sits in the strip: as wide as fits, cropped top and bottom around the
 * desks when it would be much taller than the strip, letterboxed on narrow screens. Pure.
 */
export function stripFit(frameW: number, frameH: number, roomW: number, roomH: number, focusY: number) {
  const s = Math.min(frameW / roomW, (frameH * MAX_OVERSCAN) / roomH);
  const w = roomW * s;
  const h = roomH * s;
  const top = h <= frameH ? (frameH - h) / 2 : Math.min(0, Math.max(frameH - h, frameH / 2 - focusY * s));
  return { left: (frameW - w) / 2, top, width: w, height: h };
}

