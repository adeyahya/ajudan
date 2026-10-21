/**
 * Procedural pixel art. Characters are composed into small pixel buffers (16x24 art inside an 18x26
 * buffer that leaves room for the auto outline), then baked once into offscreen canvases.
 */

import type { Dir } from "./room";

export const SPR_W = 18;
export const SPR_H = 26;
/** Feet anchor inside the buffer. */
export const SPR_AX = 9;
export const SPR_AY = 24;

// ---------- color helpers ----------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export function shade(hex: string, f: number) {
  const [r, g, b] = hexToRgb(hex);
  return f < 0 ? toHex(r * (1 + f), g * (1 + f), b * (1 + f)) : toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
export function rgba(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Small deterministic hash of a string. */
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- pixel buffer ----------

type Buf = { w: number; h: number; px: (string | null)[] };
const newBuf = (w = SPR_W, h = SPR_H): Buf => ({ w, h, px: new Array(w * h).fill(null) });

/** Art coordinates are the 16x24 design grid; the buffer adds a 1px margin on the left and top. */
function set(b: Buf, x: number, y: number, c: string | null) {
  const bx = x + 1;
  const by = y + 1;
  if (bx < 0 || by < 0 || bx >= b.w || by >= b.h) return;
  b.px[by * b.w + bx] = c;
}
function rect(b: Buf, x: number, y: number, w: number, h: number, c: string | null) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(b, i, j, c);
}
function outline(b: Buf, color: string) {
  const src = b.px.slice();
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (src[y * b.w + x]) continue;
      const n =
        (x > 0 && src[y * b.w + x - 1]) ||
        (x < b.w - 1 && src[y * b.w + x + 1]) ||
        (y > 0 && src[(y - 1) * b.w + x]) ||
        (y < b.h - 1 && src[(y + 1) * b.w + x]);
      if (n) b.px[y * b.w + x] = color;
    }
}

function mirror(b: Buf): Buf {
  const out = newBuf(b.w, b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) out.px[y * b.w + x] = b.px[y * b.w + (b.w - 1 - x)];
  return out;
}

function bake(b: Buf, silhouette?: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = b.w;
  c.height = b.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(b.w, b.h);
  for (let i = 0; i < b.px.length; i++) {
    const col = b.px[i];
    if (!col) continue;
    const [r, g, bl] = hexToRgb(silhouette ?? col);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = bl;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- characters ----------

const SKINS = ["#f6d3b3", "#eec09a", "#d9a074", "#b97b52", "#8d5a3b", "#f3c9a6"];
const HAIRS = ["#2b2230", "#4a3226", "#7a4b2a", "#a35a2c", "#d9a441", "#e8c77a", "#6b6f80", "#3b2f5a", "#c4553a"];
const PANTS = ["#3b4563", "#4a3f39", "#2f3a3f", "#5b5e6b", "#394b3e"];
export const HAIR_STYLES = ["short", "spiky", "long", "bob", "bun", "ponytail", "curly", "beanie"] as const;
type HairStyle = (typeof HAIR_STYLES)[number];

export type Look = {
  skin: string;
  hair: string;
  style: HairStyle;
  shirt: string;
  pants: string;
  beanie: string;
};

export function lookFor(id: string, color: string): Look {
  const h = hashStr(id);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 4) % HAIRS.length],
    style: HAIR_STYLES[(h >>> 8) % HAIR_STYLES.length],
    shirt: color,
    pants: PANTS[(h >>> 12) % PANTS.length],
    beanie: shade(color, -0.35),
  };
}

type Legs = "stand" | "walkA" | "walkB" | "sit";
type Arms = "down" | "swingA" | "swingB" | "up" | "typeA" | "typeB" | "hold";
type Pose = { dir: Dir; legs: Legs; arms: Arms; blink?: boolean; slump?: boolean };

const OUTLINE = "#2a1d22";
const SHOE = "#3a2b2b";
const EYE = "#2a1d22";
const BLUSH = "#f29a9a";

function drawHair(b: Buf, L: Look, dir: Dir, top: number) {
  const hc = L.hair;
  const hs = shade(hc, -0.25);
  const hl = shade(hc, 0.25);
  const t = top; // head top row
  const s = L.style;
  const cap = () => {
    rect(b, 4, t - 1, 8, 1, hc);
    rect(b, 3, t, 10, 3, hc);
    rect(b, 5, t, 4, 1, hl);
  };
  if (s === "beanie") {
    rect(b, 4, t - 2, 8, 1, L.beanie);
    rect(b, 3, t - 1, 10, 3, L.beanie);
    rect(b, 3, t + 2, 10, 1, shade(L.beanie, 0.25));
    rect(b, 7, t - 3, 2, 1, shade(L.beanie, 0.35));
    if (dir === "up") rect(b, 3, t + 3, 10, 5, hc);
    else if (dir === "right") rect(b, 3, t + 3, 4, 4, hc);
    else {
      rect(b, 3, t + 3, 1, 3, hc);
      rect(b, 12, t + 3, 1, 3, hc);
    }
    return;
  }
  if (s === "curly") {
    rect(b, 3, t - 2, 10, 1, hc);
    rect(b, 2, t - 1, 12, 4, hc);
    for (const x of [2, 5, 8, 11]) set(b, x, t - 2, null);
    for (const x of [4, 7, 10]) set(b, x, t - 1, hl);
  } else {
    cap();
  }
  if (s === "spiky") for (const x of [4, 6, 8, 10]) set(b, x, t - 2, hc);
  if (s === "bun") {
    rect(b, 6, t - 4, 4, 3, hc);
    set(b, 7, t - 4, hl);
  }

  const sideLen = s === "long" ? 12 : s === "bob" ? 7 : s === "curly" ? 6 : 3;
  const wide = s === "long" || s === "bob" || s === "curly";
  if (dir === "down") {
    // Fringe with a parting.
    rect(b, 3, t + 3, 10, 1, hc);
    set(b, 7, t + 3, null);
    if (s === "short" || s === "spiky") set(b, 8, t + 3, null);
    if (s === "bob" || s === "long") rect(b, 4, t + 4, 2, 1, hc);
    rect(b, 3, t + 3, 1, sideLen, hc);
    rect(b, 12, t + 3, 1, sideLen, hc);
    if (wide) {
      rect(b, 2, t + 1, 1, sideLen + 2, hs);
      rect(b, 13, t + 1, 1, sideLen + 2, hs);
    }
    if (s === "ponytail") rect(b, 13, t + 3, 1, 5, hs);
  } else if (dir === "up") {
    rect(b, 3, t, 10, 9, hc);
    rect(b, 4, t + 8, 8, 1, hs);
    if (wide) {
      rect(b, 2, t, 12, sideLen + 2, hc);
      rect(b, 3, t + sideLen + 1, 10, 1, hs);
    }
    if (s === "ponytail") {
      rect(b, 7, t + 8, 2, 5, hc);
      rect(b, 7, t + 12, 2, 1, hs);
    }
    if (s === "bun") set(b, 7, t - 3, hs);
  } else {
    // Facing right: hair covers the back (left) of the head.
    rect(b, 3, t, 10, 3, hc);
    rect(b, 3, t + 3, 5, 5, hc);
    rect(b, 8, t + 3, 4, 1, hc);
    set(b, 6, t + 5, hs);
    if (wide) rect(b, 2, t, 2, sideLen + 2, hs);
    if (s === "long") rect(b, 3, t + 8, 3, 4, hc);
    if (s === "ponytail") {
      rect(b, 1, t + 3, 2, 2, hc);
      rect(b, 1, t + 5, 1, 4, hs);
    }
  }
}

function drawChar(L: Look, p: Pose): Buf {
  const b = newBuf();
  const skin = L.skin;
  const skinS = shade(skin, -0.15);
  const shirt = L.shirt;
  const shirtS = shade(shirt, -0.25);
  const shirtL = shade(shirt, 0.2);
  const pants = L.pants;
  const sit = p.legs === "sit";
  const o = sit ? 2 : 0; // seated: upper body sits 2px lower
  const head = 2 + o + (p.slump ? 1 : 0);
  const body = 12 + o;

  // Legs + shoes
  if (sit) {
    if (p.dir === "down") {
      rect(b, 4, 18, 8, 2, pants);
      rect(b, 5, 20, 2, 2, pants);
      rect(b, 9, 20, 2, 2, pants);
      rect(b, 4, 22, 3, 1, SHOE);
      rect(b, 9, 22, 3, 1, SHOE);
    } else {
      rect(b, 5, 18, 6, 2, pants);
    }
  } else if (p.dir === "right") {
    if (p.legs === "stand") {
      rect(b, 6, 18, 4, 4, pants);
      rect(b, 6, 22, 5, 1, SHOE);
    } else {
      const fwd = p.legs === "walkA";
      rect(b, fwd ? 8 : 6, 18, 3, 3, pants);
      rect(b, fwd ? 5 : 8, 18, 3, 3, shade(pants, -0.2));
      rect(b, fwd ? 9 : 7, 21, 3, 1, SHOE);
      rect(b, fwd ? 4 : 8, 21, 3, 1, shade(SHOE, -0.2));
    }
  } else {
    const lUp = p.legs === "walkA" ? 1 : 0;
    const rUp = p.legs === "walkB" ? 1 : 0;
    rect(b, 5, 18, 3, 3 - lUp, pants);
    rect(b, 8, 18, 3, 3 - rUp, pants);
    rect(b, 5, 21 - lUp, 3, 1, SHOE);
    rect(b, 8, 21 - rUp, 3, 1, SHOE);
    if (p.dir === "up") rect(b, 7, 18, 2, 1, shade(pants, -0.2));
  }

  // Torso
  if (p.dir === "right") {
    rect(b, 5, body, 6, 6, shirt);
    rect(b, 5, body + 5, 6, 1, shirtS);
    rect(b, 9, body, 2, 1, shirtL);
  } else {
    rect(b, 4, body, 8, 6, shirt);
    rect(b, 4, body + 5, 8, 1, shirtS);
    if (p.dir === "down") {
      rect(b, 7, body, 2, 1, skin);
      set(b, 6, body, shirtL);
      set(b, 9, body, shirtL);
    } else {
      rect(b, 7, body + 1, 2, 3, shirtS);
    }
  }

  // Arms
  const armY = body + 1;
  if (p.dir === "right") {
    const sw = p.arms === "swingA" ? 1 : p.arms === "swingB" ? -1 : 0;
    if (p.arms === "hold") {
      rect(b, 8, armY, 2, 2, shirtS);
      rect(b, 10, armY + 1, 2, 1, skin);
    } else {
      rect(b, 7 + sw, armY, 2, 3, shirtS);
      rect(b, 7 + sw, armY + 3, 2, 1, skin);
    }
  } else if (p.arms === "up") {
    rect(b, 2, head + 2, 2, 8, shirt);
    rect(b, 12, head + 2, 2, 8, shirt);
    rect(b, 2, head + 1, 2, 1, skin);
    rect(b, 12, head + 1, 2, 1, skin);
  } else if (p.arms === "typeA" || p.arms === "typeB") {
    const a = p.arms === "typeA" ? 0 : 1;
    rect(b, 3, armY - a, 1, 3, shirtS);
    rect(b, 12, armY - (1 - a), 1, 3, shirtS);
    set(b, 2, armY + 1 - a, shirtS);
    set(b, 13, armY + 1 - (1 - a), shirtS);
  } else if (p.arms === "hold") {
    rect(b, 3, armY, 1, 4, shirtS);
    rect(b, 12, armY, 1, 2, shirtS);
    rect(b, 10, armY + 2, 3, 1, skin);
  } else {
    const l = p.arms === "swingA" ? 1 : 0;
    const r = p.arms === "swingB" ? 1 : 0;
    rect(b, 3, armY - l, 1, 4, shirtS);
    rect(b, 12, armY - r, 1, 4, shirtS);
    set(b, 3, armY + 4 - l, skin);
    set(b, 12, armY + 4 - r, skin);
  }

  // Head
  rect(b, 3, head, 10, 10, skin);
  set(b, 3, head, null);
  set(b, 12, head, null);
  set(b, 3, head + 9, null);
  set(b, 12, head + 9, null);
  rect(b, 4, head + 9, 8, 1, skinS);
  if (p.dir === "down") {
    const ey = head + 5;
    if (p.blink) {
      rect(b, 5, ey + 1, 2, 1, EYE);
      rect(b, 9, ey + 1, 2, 1, EYE);
    } else {
      rect(b, 5, ey, 2, 2, EYE);
      rect(b, 9, ey, 2, 2, EYE);
      set(b, 5, ey, "#ffffff");
      set(b, 9, ey, "#ffffff");
    }
    set(b, 4, ey + 2, BLUSH);
    set(b, 11, ey + 2, BLUSH);
    rect(b, 7, ey + 3, 2, 1, shade(skin, -0.35));
  } else if (p.dir === "right") {
    const ey = head + 5;
    if (p.blink) rect(b, 10, ey + 1, 2, 1, EYE);
    else {
      rect(b, 10, ey, 2, 2, EYE);
      set(b, 11, ey, "#ffffff");
    }
    set(b, 9, ey + 2, BLUSH);
    set(b, 13, ey + 1, skin);
  }
  drawHair(b, L, p.dir, head);

  outline(b, OUTLINE);
  return b;
}

export type FrameKey =
  | `stand_${Dir}`
  | `walkA_${Dir}`
  | `walkB_${Dir}`
  | "blink_down"
  | "hold_down"
  | "hold_right"
  | "hold_left"
  | "sit_down"
  | "sit_down_blink"
  | "sit_down_stretch"
  | "sit_up_typeA"
  | "sit_up_typeB"
  | "sit_up_slump";

export type Sheet = { frames: Map<FrameKey, HTMLCanvasElement>; glow: Map<FrameKey, HTMLCanvasElement> };

export function buildSheet(L: Look): Sheet {
  const frames = new Map<FrameKey, HTMLCanvasElement>();
  const glow = new Map<FrameKey, HTMLCanvasElement>();
  const add = (key: FrameKey, b: Buf) => {
    frames.set(key, bake(b));
    glow.set(key, bake(b, "#ffffff"));
  };
  const both = (key: string, pose: Omit<Pose, "dir">) => {
    for (const dir of ["down", "up"] as const) add(`${key}_${dir}` as FrameKey, drawChar(L, { ...pose, dir }));
    const right = drawChar(L, { ...pose, dir: "right" });
    add(`${key}_right` as FrameKey, right);
    add(`${key}_left` as FrameKey, mirror(right));
  };
  both("stand", { legs: "stand", arms: "down" });
  both("walkA", { legs: "walkA", arms: "swingA" });
  both("walkB", { legs: "walkB", arms: "swingB" });
  add("blink_down", drawChar(L, { dir: "down", legs: "stand", arms: "down", blink: true }));
  add("hold_down", drawChar(L, { dir: "down", legs: "stand", arms: "hold" }));
  const hr = drawChar(L, { dir: "right", legs: "stand", arms: "hold" });
  add("hold_right", hr);
  add("hold_left", mirror(hr));
  add("sit_down", drawChar(L, { dir: "down", legs: "sit", arms: "down" }));
  add("sit_down_blink", drawChar(L, { dir: "down", legs: "sit", arms: "down", blink: true }));
  add("sit_down_stretch", drawChar(L, { dir: "down", legs: "sit", arms: "up", blink: true }));
  add("sit_up_typeA", drawChar(L, { dir: "up", legs: "sit", arms: "typeA" }));
  add("sit_up_typeB", drawChar(L, { dir: "up", legs: "sit", arms: "typeB" }));
  add("sit_up_slump", drawChar(L, { dir: "up", legs: "sit", arms: "down", slump: true }));
  return { frames, glow };
}

// ---------- small pixel maps ----------

/** Draw a string pixel map. Each char maps through `pal`; "." is transparent. */
export function drawMap(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, pal: Record<string, string>) {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const c = pal[row[i]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

export const ICON_ENVELOPE = [
  "ooooooooo",
  "owwwwwwwo",
  "oowwwwwoo",
  "owowwwowo",
  "owwoooowo",
  "owwwwwwwo",
  "ooooooooo",
];
export const ICON_DOC = [
  "ooooo..",
  "owwwoo.",
  "owwwwwo",
  "oaaaawo",
  "owwwwwo",
  "oaaaawo",
  "owwwwwo",
  "oaaawwo",
  "ooooooo",
];
export const ICON_BANG = [
  ".oo.",
  ".oo.",
  ".oo.",
  ".oo.",
  "....",
  ".oo.",
];
export const ICON_WARN = [
  "....o....",
  "...owo...",
  "...owo...",
  "..owkwo..",
  "..owkwo..",
  ".owwkwwo.",
  ".owwwwwo.",
  "owwwkwwwo",
  "ooooooooo",
];
export const ICON_HEART = [".o.o.", "ooooo", "ooooo", ".ooo.", "..o.."];
export const ICON_COFFEE = ["wwww.", "wwwww", "wwwww", ".ww.."];

// ---------- the office cat ----------

export type CatFrames = { walkA: HTMLCanvasElement; walkB: HTMLCanvasElement; sit: HTMLCanvasElement; loaf: HTMLCanvasElement };
export type CatSheet = { right: CatFrames; left: CatFrames };

/** A small orange tabby, 14x10 art in a 16x12 buffer, facing right. */
export function buildCat(): CatSheet {
  const O = "#e8913a";
  const D = "#b9662a";
  const Lt = "#f6c27f";
  const W = "#fff4e6";
  const E = "#2a1d22";
  const P = "#f29a9a";
  const make = (pose: "walkA" | "walkB" | "sit" | "loaf") => {
    const b = newBuf(16, 13);
    if (pose === "loaf") {
      rect(b, 1, 5, 10, 4, O);
      rect(b, 2, 4, 8, 1, O);
      rect(b, 2, 8, 8, 1, Lt);
      set(b, 4, 5, D);
      set(b, 6, 5, D);
      set(b, 4, 6, D);
      set(b, 6, 6, D);
      rect(b, 8, 3, 4, 4, O);
      set(b, 8, 2, O);
      set(b, 11, 2, O);
      rect(b, 9, 5, 2, 1, E); // closed eyes
      rect(b, 0, 8, 3, 1, D); // tail wrapped
      set(b, 10, 6, W);
    } else if (pose === "sit") {
      rect(b, 3, 4, 6, 6, O);
      rect(b, 4, 6, 4, 4, Lt);
      rect(b, 6, 1, 5, 4, O);
      set(b, 6, 0, O);
      set(b, 10, 0, O);
      set(b, 9, 2, E);
      set(b, 7, 2, E);
      set(b, 8, 3, P);
      rect(b, 1, 8, 2, 2, D);
      set(b, 1, 7, D);
      rect(b, 4, 10, 1, 1, W);
      rect(b, 7, 10, 1, 1, W);
    } else {
      const a = pose === "walkA";
      rect(b, 1, 4, 9, 4, O);
      rect(b, 2, 7, 7, 1, Lt);
      set(b, 3, 4, D);
      set(b, 5, 4, D);
      set(b, 3, 5, D);
      set(b, 5, 5, D);
      rect(b, 9, 2, 4, 4, O);
      set(b, 9, 1, O);
      set(b, 12, 1, O);
      set(b, 11, 3, E);
      set(b, 13, 4, P);
      set(b, 12, 5, W);
      rect(b, 0, 1, 1, 3, D);
      set(b, 1, 3, D);
      rect(b, a ? 2 : 3, 8, 1, 2, O);
      rect(b, a ? 4 : 5, 8, 1, 1, D);
      rect(b, a ? 8 : 7, 8, 1, 2, O);
      rect(b, a ? 6 : 9, 8, 1, 1, D);
    }
    outline(b, OUTLINE);
    return b;
  };
  const poses = ["walkA", "walkB", "sit", "loaf"] as const;
  const right = {} as CatFrames;
  const left = {} as CatFrames;
  for (const p of poses) {
    const b = make(p);
    right[p] = bake(b);
    left[p] = bake(mirror(b));
  }
  return { right, left };
}

export const ICON_Z = ["ooo", "..o", ".o.", "o..", "ooo"];
