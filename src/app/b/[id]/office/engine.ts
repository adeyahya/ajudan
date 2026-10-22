/**
 * The 2D office simulation and renderer. Plain TypeScript, no React: the canvas component owns one
 * engine, feeds it teammates/effects, calls update(dt) + render() from requestAnimationFrame and reads
 * `anchors` to position the DOM overlay (name tags, bubbles).
 */

import { type Dir, type DeskSlot, findPath, layoutFor, type OfficeLayout, type Poi, TILE, type Tile } from "./room";
import {
  buildCat,
  buildSheet,
  type CatSheet,
  drawMap,
  type FrameKey,
  hashStr,
  ICON_DOC,
  ICON_ENVELOPE,
  ICON_HEART,
  ICON_Z,
  lookFor,
  mix,
  rgba,
  type Sheet,
  shade,
  SPR_AX,
  SPR_AY,
} from "./sprites";
import type { OfficeTeammate } from "./state";
import type { OfficeEffect } from "./types";

const WALK_SPEED = 46; // px/s
const STEP_FPS = 7;

type Step =
  | { k: "walk"; to: Tile; final?: { x: number; y: number }; face?: Dir }
  | { k: "wait"; t: number; face?: Dir }
  | { k: "do"; fn: () => void };

type Actor = {
  id: string;
  tm: OfficeTeammate;
  slot: DeskSlot;
  sheet: Sheet;
  seed: number;
  x: number;
  y: number;
  dir: Dir;
  steps: Step[];
  kind: "none" | "wander" | "delegate";
  path: { x: number; y: number }[] | null;
  moving: boolean;
  walkT: number;
  nextWander: number;
  nextBlink: number;
  blinkUntil: number;
  nextStretch: number;
  stretchUntil: number;
  holding: boolean;
  sitting: boolean;
  poi: Poi | null;
  nextSmoke: number;
  typePauseUntil: number;
  nextTypePause: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  color: string;
  size: number;
  kind: "square" | "smoke" | "spark" | "steam" | "z";
};

type Flyer = {
  icon: "doc" | "envelope" | "heart";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  arc: number;
  onLand?: () => void;
};

export type Anchor = {
  id: string;
  x: number;
  /** Top of the head (for bubbles). */
  top: number;
  /** Bottom of the feet (for name tags). */
  feet: number;
  seated: boolean;
  /** At their own desk (seated or standing beside the chair). */
  home: boolean;
  /** Where a bubble sits while at the desk: above the monitor. */
  bubbleY: number;
};

const C = {
  wallTop: "#5b4636",
  wallTopL: "#7a5d47",
  wall: "#efe3cf",
  wallStripe: "#e7d8c0",
  wains: "#b8875d",
  wainsD: "#9c6f48",
  wainsL: "#cf9e73",
  base: "#6e4c33",
  floorA: "#d9a66f",
  floorB: "#cf9a62",
  floorC: "#e2b27c",
  floorSeam: "#b07b48",
  wood: "#c48f5f",
  woodL: "#dcae7e",
  woodD: "#93613b",
  woodDD: "#6e452c",
  metal: "#9aa3b2",
  dark: "#2b2d42",
  shadow: "rgba(40,20,10,0.18)",
  rug: "#6f9a83",
  rugL: "#86b29a",
  rugD: "#557d68",
  carpet: "#c9cdd8",
  carpetL: "#d6d9e2",
  chair: "#3d4350",
  chairL: "#525a6b",
};

/** How the room is lit at one moment of the day. `tint` multiplies everything; the rest is light added on top. */
type Light = {
  tint: string;
  sun: string;
  /** Strength of the beams through the windows (moonlight at night). */
  beam: number;
  /** Beams lean right in the morning, left in the afternoon. */
  slant: number;
  /** 0 by day, 1 at night: how much lamps and screens glow. */
  night: number;
  skyTop: string;
  skyBot: string;
  land: string;
};
const NIGHT: Light = { tint: "#7d86bd", sun: "#9db4ff", beam: 0.22, slant: 0.3, night: 1, skyTop: "#141c3a", skyBot: "#2a3866", land: "#1d2a45" };
const DAY: Light = { tint: "#fffaf2", sun: "#fff4d6", beam: 0.55, slant: 0.6, night: 0, skyTop: "#8fd0f5", skyBot: "#cdeefd", land: "#7fb38a" };
const LIGHT_KEYS: [number, Light][] = [
  [0, NIGHT],
  [5.6, NIGHT],
  [6.4, { tint: "#f6d9c8", sun: "#ffc49a", beam: 0.45, slant: 0.9, night: 0.3, skyTop: "#f6a96b", skyBot: "#fbd39a", land: "#6f8f74" }],
  [8.5, DAY],
  [13, { ...DAY, tint: "#ffffff", beam: 0.45, slant: 0 }],
  [16, { ...DAY, tint: "#fff3e2", sun: "#ffe2b0", beam: 0.6, slant: -0.6 }],
  [17.6, { tint: "#ffd6b0", sun: "#ffad66", beam: 0.9, slant: -1.1, night: 0.1, skyTop: "#f59a5c", skyBot: "#fcd79a", land: "#8a8a5a" }],
  [18.8, { tint: "#b9a6cf", sun: "#ff8f7a", beam: 0.3, slant: -1.3, night: 0.6, skyTop: "#4a3f7a", skyBot: "#d98a7a", land: "#3a3f5a" }],
  [20, NIGHT],
  [24, NIGHT],
];

type Mote = { x: number; y: number; vx: number; vy: number; phase: number };

const BINDER_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

const FONT3: Record<string, string[]> = {
  W: ["o.o", "o.o", "o.o", "ooo", "o.o"],
  O: ["ooo", "o.o", "o.o", "o.o", "ooo"],
  R: ["oo.", "o.o", "oo.", "o.o", "o.o"],
  K: ["o.o", "o.o", "oo.", "o.o", "o.o"],
};

const PLANT = [
  ".....gG.......",
  "...gGgg..gG...",
  "..gGggd.gGgg..",
  ".gGgdgggGggd..",
  "..ggGgGggdggg.",
  ".gGgdgGgGggdg.",
  "gGgg.ggdGgggdg",
  ".ggGgdGgggdg..",
  "..gdgGggdgg...",
  "...ggdgGgg....",
  ".....dgd......",
];

export class OfficeEngine {
  L: OfficeLayout;
  readonly world: HTMLCanvasElement;
  private wctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement | null = null;
  private actors = new Map<string, Actor>();
  private order: string[] = [];
  private particles: Particle[] = [];
  private flyers: Flyer[] = [];
  private seenFx = new Set<number>();
  private t = 0;
  private pending = 0;
  private deliverables = 0;
  /** Out of Claude usage: everyone naps at their desk under dimmed lights. */
  private resting = false;
  private docsInFlight = 0;
  private papersInFlight = 0;
  private shelfBump = 0;
  private inboxBump = 0;
  private nextSteam = 0;
  private motes: Mote[] = [];
  /** For previewing the lighting at another hour (dev only). */
  hourOverride: number | null = null;
  private cat: {
    sheet: CatSheet;
    x: number;
    y: number;
    dir: "left" | "right";
    path: { x: number; y: number }[];
    mode: "walk" | "sit" | "sleep";
    until: number;
    walkT: number;
    nextZ: number;
  } | null = null;
  hoverId: string | null = null;
  selectedId: string | null = null;

  constructor(n: number) {
    this.L = layoutFor(n);
    this.world = document.createElement("canvas");
    this.wctx = this.world.getContext("2d")!;
    this.resizeWorld();
  }

  private resizeWorld() {
    this.world.width = this.L.W * TILE;
    this.world.height = this.L.H * TILE;
    this.wctx.imageSmoothingEnabled = false;
    this.bg = null;
  }

  // ---------- data in ----------

  sync(teammates: OfficeTeammate[], pendingApprovals: number, deliverableCount: number, resting = false) {
    this.pending = pendingApprovals;
    this.deliverables = deliverableCount;
    this.resting = resting;
    if (teammates.length !== this.L.desks.length) {
      this.L = layoutFor(teammates.length);
      this.resizeWorld();
      for (const a of this.actors.values()) a.steps = [];
    }
    const ids = new Set(teammates.map((t) => t.id));
    for (const id of [...this.actors.keys()]) if (!ids.has(id)) this.actors.delete(id);
    this.order = teammates.map((t) => t.id);
    teammates.forEach((tm, i) => {
      const slot = this.L.desks[i];
      const a = this.actors.get(tm.id);
      if (!a) {
        const seed = hashStr(tm.id);
        this.actors.set(tm.id, {
          id: tm.id,
          tm,
          slot,
          sheet: buildSheet(lookFor(tm.id, tm.color)),
          seed,
          x: slot.seatX,
          y: slot.seatY,
          dir: "down",
          steps: [],
          kind: "none",
          path: null,
          moving: false,
          walkT: 0,
          nextWander: this.t + 6 + (seed % 20),
          nextBlink: this.t + 1 + (seed % 7) * 0.4,
          blinkUntil: 0,
          nextStretch: this.t + 8 + (seed % 13),
          stretchUntil: 0,
          holding: false,
          sitting: false,
          poi: null,
          nextSmoke: 0,
          typePauseUntil: 0,
          nextTypePause: this.t + 2,
        });
        return;
      }
      if (a.tm.color !== tm.color) a.sheet = buildSheet(lookFor(tm.id, tm.color));
      const moved = a.slot.dx !== slot.dx || a.slot.dy !== slot.dy;
      a.slot = slot;
      a.tm = tm;
      if (moved && a.kind !== "delegate") {
        a.steps = [];
        a.path = null;
        a.x = slot.seatX;
        a.y = slot.seatY;
      }
    });
  }

  pushEffect(e: OfficeEffect) {
    if (this.seenFx.has(e.key)) return;
    this.seenFx.add(e.key);
    if (this.seenFx.size > 500) this.seenFx = new Set([...this.seenFx].slice(-200));
    const a = e.teammateId ? this.actors.get(e.teammateId) : undefined;
    switch (e.type) {
      case "delegated": {
        const from = e.from ? this.actors.get(e.from) : undefined;
        const to = e.to ? this.actors.get(e.to) : undefined;
        if (from && to && from !== to) this.delegate(from, to);
        break;
      }
      case "task_done":
        if (a) this.confetti(a);
        break;
      case "task_failed":
        if (a) for (let i = 0; i < 6; i++) this.puff(a.slot.dx * TILE + 16 + (Math.random() * 8 - 4), a.slot.dy * TILE - 8, 0.4);
        break;
      case "deliverable_saved":
        if (a) {
          this.docsInFlight++;
          this.flyers.push({
            icon: "doc",
            x0: a.x,
            y0: this.headY(a) - 4,
            x1: this.L.shelf.x * TILE + 16,
            y1: this.L.shelf.y * TILE - 14,
            t: 0,
            dur: 1.3,
            arc: 34,
            onLand: () => {
              this.docsInFlight = Math.max(0, this.docsInFlight - 1);
              this.shelfBump = 0.35;
              this.sparkle(this.L.shelf.x * TILE + 16, this.L.shelf.y * TILE - 14, 6);
            },
          });
        }
        break;
      case "approval_requested":
        if (a) {
          this.papersInFlight++;
          const o = this.L.owner;
          this.flyers.push({
            icon: "envelope",
            x0: a.x,
            y0: this.headY(a) - 4,
            x1: o.dx * TILE + 40,
            y1: o.dy * TILE + 2,
            t: 0,
            dur: 1.4,
            arc: 40,
            onLand: () => {
              this.papersInFlight = Math.max(0, this.papersInFlight - 1);
              this.inboxBump = 0.35;
            },
          });
        }
        break;
    }
  }

  // ---------- behaviour ----------

  private seatTile(a: Actor): Tile {
    return { x: Math.floor(a.slot.seatX / TILE), y: Math.floor(a.slot.seatY / TILE) };
  }

  private atSeat(a: Actor) {
    return a.steps.length === 0 && Math.abs(a.x - a.slot.seatX) < 0.5 && Math.abs(a.y - a.slot.seatY) < 0.5;
  }

  private goHome(a: Actor) {
    a.steps = [{ k: "walk", to: this.seatTile(a), final: { x: a.slot.seatX, y: a.slot.seatY } }];
    a.path = null;
    a.kind = "none";
    a.poi = null;
    a.sitting = false;
  }

  private delegate(from: Actor, to: Actor) {
    const v = to.slot.visit;
    from.path = null;
    from.poi = null;
    from.kind = "delegate";
    from.steps = [
      { k: "walk", to: v, final: { x: v.x * TILE + 5, y: to.slot.seatY + 1 }, face: "left" },
      {
        k: "do",
        fn: () => {
          this.flyers.push({
            icon: "envelope",
            x0: from.x - 2,
            y0: from.y - 26,
            x1: to.x,
            y1: this.headY(to) - 2,
            t: 0,
            dur: 0.7,
            arc: 14,
            onLand: () => {
              this.sparkle(to.x, this.headY(to) - 2, 4);
              this.flyers.push({ icon: "heart", x0: to.x, y0: this.headY(to) - 4, x1: to.x, y1: this.headY(to) - 16, t: 0, dur: 0.9, arc: 0 });
            },
          });
        },
      },
      { k: "wait", t: 1.4, face: "left" },
      { k: "walk", to: this.seatTile(from), final: { x: from.slot.seatX, y: from.slot.seatY } },
      { k: "do", fn: () => (from.kind = "none") },
    ];
  }

  private planWander(a: Actor) {
    const taken = new Set([...this.actors.values()].filter((o) => o !== a && o.poi).map((o) => o.poi!.kind + o.poi!.tile.x));
    const options = this.L.pois.filter((p) => !taken.has(p.kind + p.tile.x));
    if (!options.length) return;
    // Coffee is the favourite.
    const p = Math.random() < 0.4 ? (options.find((o) => o.kind === "coffee") ?? options[0]) : options[Math.floor(Math.random() * options.length)];
    a.poi = p;
    a.kind = "wander";
    const tx = p.tile.x * TILE + 8;
    const ty = p.tile.y * TILE + 10;
    const sit = p.sit;
    a.steps = [
      { k: "walk", to: p.tile, final: { x: tx, y: ty }, face: p.face },
      ...(sit
        ? ([
            { k: "walk", to: p.tile, final: sit, face: "down" },
            { k: "do", fn: () => (a.sitting = true) },
            { k: "wait", t: 4 + Math.random() * 4, face: "down" },
            { k: "do", fn: () => (a.sitting = false) },
            { k: "walk", to: p.tile, final: { x: tx, y: ty } },
          ] satisfies Step[])
        : ([{ k: "wait", t: 2.5 + Math.random() * 2.5, face: p.face }] satisfies Step[])),
      {
        k: "do",
        fn: () => {
          if (p.kind === "coffee") a.holding = true;
          if (p.kind === "water") this.sparkle(tx, ty - 26, 2);
        },
      },
      { k: "walk", to: this.seatTile(a), final: { x: a.slot.seatX, y: a.slot.seatY } },
      {
        k: "do",
        fn: () => {
          a.kind = "none";
          a.poi = null;
          a.holding = false;
        },
      },
    ];
  }

  private napping(a: Actor) {
    return this.resting && a.tm.state === "idle" && this.atSeat(a);
  }

  private stepActor(a: Actor, dt: number) {
    const st = this.resting && a.tm.state === "idle" ? "resting" : a.tm.state;
    if (st !== "idle" && a.kind === "wander") this.goHome(a);
    if (a.steps.length === 0 && !this.atSeat(a)) this.goHome(a);
    if (st === "idle" && a.kind === "none" && this.atSeat(a) && this.t > a.nextWander) {
      a.nextWander = this.t + 14 + Math.random() * 26;
      this.planWander(a);
    }
    if (st !== "idle") a.nextWander = Math.max(a.nextWander, this.t + 8);

    // Blink + stretch timers.
    if (this.t > a.nextBlink) {
      a.blinkUntil = this.t + 0.13;
      a.nextBlink = this.t + 2 + Math.random() * 3.5;
    }
    if (st === "idle" && this.t > a.nextStretch) {
      a.stretchUntil = this.t + 1.3;
      a.nextStretch = this.t + 9 + Math.random() * 14;
    }
    if (this.t > a.nextTypePause) {
      a.typePauseUntil = this.t + 0.4 + Math.random() * 0.9;
      a.nextTypePause = this.t + 1.5 + Math.random() * 3;
    }

    a.moving = false;
    const s = a.steps[0];
    if (!s) return;
    if (s.k === "do") {
      a.steps.shift();
      s.fn();
      return;
    }
    if (s.k === "wait") {
      if (s.face) a.dir = s.face;
      s.t -= dt;
      if (s.t <= 0) a.steps.shift();
      return;
    }
    if (!a.path) {
      const start = { x: Math.floor(a.x / TILE), y: Math.floor(a.y / TILE) };
      const tiles = start.x === s.to.x && start.y === s.to.y ? [] : findPath(this.L, start, s.to);
      a.path = tiles.map((t) => ({ x: t.x * TILE + 8, y: t.y * TILE + 10 }));
      if (s.final) {
        if (a.path.length) a.path[a.path.length - 1] = s.final;
        else a.path.push(s.final);
      }
    }
    let budget = WALK_SPEED * dt;
    while (budget > 0 && a.path.length) {
      const wp = a.path[0];
      const dx = wp.x - a.x;
      const dy = wp.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      if (d <= budget) {
        a.x = wp.x;
        a.y = wp.y;
        budget -= d;
        a.path.shift();
      } else {
        a.x += (dx / d) * budget;
        a.y += (dy / d) * budget;
        budget = 0;
      }
      a.moving = true;
    }
    a.walkT += dt;
    if (!a.path.length) {
      a.path = null;
      a.steps.shift();
      if (s.face) a.dir = s.face;
      if (a.steps.length === 0 && this.atSeat(a)) a.dir = "down";
    }
  }

  update(dt: number) {
    this.t += dt;
    for (const id of this.order) {
      const a = this.actors.get(id);
      if (a) this.stepActor(a, dt);
    }
    this.stepCat(dt);
    // Error smoke + coffee steam.
    for (const a of this.actors.values()) {
      if (this.napping(a) && this.t > a.nextSmoke) {
        a.nextSmoke = this.t + 1.4 + Math.random() * 0.8;
        this.particles.push({ x: a.x + 3, y: a.y - 18, vx: 3, vy: -6, g: 0, life: 0, max: 1.8, color: "#ffffff", size: 1, kind: "z" });
      }
      if (a.tm.state === "error" && this.t > a.nextSmoke) {
        a.nextSmoke = this.t + 0.35 + Math.random() * 0.3;
        this.puff(a.slot.dx * TILE + 16 + (Math.random() * 6 - 3), a.slot.dy * TILE - 8, 0);
      }
      if (a.holding && Math.random() < dt * 3) this.steam(a.x + (a.dir === "left" ? -4 : 4), a.y - 13);
    }
    if (this.t > this.nextSteam) {
      this.nextSteam = this.t + 0.25 + Math.random() * 0.4;
      this.steam(this.L.counter.x * TILE + 10, this.L.counter.y * TILE - 10);
    }
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "square") p.vx *= 1 - dt * 1.5;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const f of this.flyers) {
      f.t += dt;
      if (f.t >= f.dur && f.onLand) {
        f.onLand();
        f.onLand = undefined;
      }
    }
    this.flyers = this.flyers.filter((f) => f.t < f.dur);
    this.stepMotes(dt);
    this.shelfBump = Math.max(0, this.shelfBump - dt);
    this.inboxBump = Math.max(0, this.inboxBump - dt);
  }

  /** Dust drifting in the window light. */
  private stepMotes(dt: number) {
    const lt = this.light();
    const want = lt.beam > 0.3 && lt.night < 0.5 ? 34 : 0;
    while (this.motes.length < want) {
      const wx = this.L.windows[this.motes.length % this.L.windows.length] * TILE + 2;
      const y = 32 + Math.random() * 70;
      this.motes.push({ x: wx + Math.random() * 28 + (y - 30) * lt.slant * 0.5, y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 1.5, phase: Math.random() * 6 });
    }
    if (this.motes.length > want) this.motes.length = want;
    for (const m of this.motes) {
      m.phase += dt;
      m.x += (m.vx + Math.sin(m.phase * 0.7) * 1.2) * dt;
      m.y += (m.vy + Math.cos(m.phase * 0.5) * 0.8) * dt;
      if (m.y < 30 || m.y > 105) m.vy = -m.vy;
    }
  }

  // ---------- particles ----------

  private headY(a: Actor) {
    return this.atSeat(a) && a.tm.state !== "waiting" ? a.y - 20 : a.y - 22;
  }

  private confetti(a: Actor) {
    const cx = a.x;
    const cy = this.headY(a) - 4;
    const cols = [a.tm.color, "#fde047", "#f472b6", "#60a5fa", "#34d399", "#ffffff"];
    for (let i = 0; i < 34; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 50 + Math.random() * 70;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        g: 150,
        life: 0,
        max: 1.1 + Math.random() * 0.6,
        color: cols[i % cols.length],
        size: Math.random() < 0.3 ? 2 : 1,
        kind: "square",
      });
    }
    this.sparkle(cx, cy - 4, 6);
  }

  private sparkle(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++)
      this.particles.push({
        x: x + (Math.random() - 0.5) * 22,
        y: y + (Math.random() - 0.5) * 14,
        vx: 0,
        vy: -6,
        g: 0,
        life: -Math.random() * 0.3,
        max: 0.8,
        color: i % 2 ? "#fff7c2" : "#ffffff",
        size: 1,
        kind: "spark",
      });
  }

  private puff(x: number, y: number, delay: number) {
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -9 - Math.random() * 5, g: 0, life: -delay * Math.random(), max: 1.6, color: "#6b7280", size: 2, kind: "smoke" });
  }

  private steam(x: number, y: number) {
    this.particles.push({ x: x + (Math.random() - 0.5) * 2, y, vx: (Math.random() - 0.5) * 3, vy: -7, g: 0, life: 0, max: 1.1, color: "#ffffff", size: 1, kind: "steam" });
  }

  // ---------- queries ----------

  anchors(): Anchor[] {
    const out: Anchor[] = [];
    for (const id of this.order) {
      const a = this.actors.get(id);
      if (!a) continue;
      const home = this.atSeat(a);
      const seated = home && a.tm.state !== "waiting";
      const standingHome = home && a.tm.state === "waiting";
      out.push({
        id,
        x: a.x + this.wobble(a),
        top: seated || a.sitting ? a.y - 19 : standingHome ? a.y - 21 : a.y - 24,
        feet: standingHome ? a.y + 3 : a.y,
        seated,
        home,
        bubbleY: a.slot.dy * TILE - 10,
      });
    }
    return out;
  }

  hitTest(ix: number, iy: number): string | null {
    let best: Actor | null = null;
    for (const a of this.actors.values()) {
      const seated = this.atSeat(a) && a.tm.state !== "waiting";
      const top = seated ? a.y - 20 : a.y - 24;
      const bottom = a.y + 2;
      if (ix >= a.x - 8 && ix <= a.x + 8 && iy >= top && iy <= bottom) if (!best || a.y > best.y) best = a;
    }
    return best?.id ?? null;
  }

  private wobble(a: Actor) {
    return this.atSeat(a) && a.tm.state === "waiting" ? Math.round(Math.sin(this.t * 9 + a.seed) * 1) : 0;
  }

  // ---------- rendering ----------

  render() {
    const ctx = this.wctx;
    if (!this.bg) this.bg = this.paintBackground();
    ctx.drawImage(this.bg, 0, 0);
    this.drawWindows(ctx);
    this.drawClock(ctx);

    type Drawable = { y: number; draw: () => void };
    const list: Drawable[] = [];
    const L = this.L;

    // Desks and the seated/empty chairs.
    for (const a of this.actors.values()) {
      list.push({ y: (a.slot.dy + 1) * TILE, draw: () => this.drawDesk(ctx, a) });
      const seated = this.atSeat(a);
      if (!seated || a.tm.state === "waiting") list.push({ y: a.slot.seatY - 1, draw: () => this.drawChairEmpty(ctx, a.slot.seatX, a.slot.seatY, a.tm.color) });
      list.push({ y: seated && a.tm.state === "waiting" ? a.y + 3 : a.y, draw: () => this.drawActor(ctx, a) });
    }
    // Furniture.
    list.push({ y: 4 * TILE, draw: () => this.drawShelf(ctx) });
    list.push({ y: 4 * TILE, draw: () => this.drawCounter(ctx) });
    list.push({ y: 4 * TILE, draw: () => this.drawCooler(ctx) });
    for (const p of L.plants) list.push({ y: (p.y + 1) * TILE, draw: () => this.drawPlant(ctx, p.x * TILE, p.y * TILE) });
    this.addMeeting(list);
    list.push({ y: L.owner.seatY, draw: () => this.drawOwnerChair(ctx) });
    list.push({ y: L.lounge.y * TILE + 8, draw: () => this.drawSofa(ctx) });
    list.push({ y: (L.lounge.y + 1) * TILE - 2, draw: () => this.drawLoungeSide(ctx) });
    const cat = this.cat;
    if (cat) list.push({ y: cat.y, draw: () => this.drawCat(ctx) });
    list.push({ y: (L.owner.dy + 1) * TILE, draw: () => this.drawOwnerDesk(ctx) });

    list.sort((p, q) => p.y - q.y);
    for (const d of list) d.draw();

    this.drawParticles(ctx);
    this.drawFlyers(ctx);
  }

  private rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private paintBackground() {
    const L = this.L;
    const c = document.createElement("canvas");
    c.width = L.W * TILE;
    c.height = L.H * TILE;
    const ctx = c.getContext("2d")!;
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const PW = c.width;
    const PH = c.height;
    const floorTop = 3 * TILE;

    // Wood floor planks.
    const shades = [C.floorA, C.floorB, C.floorC, C.floorA];
    for (let y = floorTop, row = 0; y < PH; y += 4, row++) {
      let x = -((row * 11) % 37);
      let k = row * 7;
      while (x < PW) {
        const len = 22 + (hashStr(`${row}:${k}`) % 26);
        R(x, y, len, 4, shades[hashStr(`p${row}${k}`) % shades.length]);
        R(x, y + 3, len, 1, C.floorSeam);
        R(x + len - 1, y, 1, 3, C.floorSeam);
        if (hashStr(`k${row}${k}`) % 5 === 0) R(x + 6, y + 1, 2, 1, shade(C.floorSeam, 0.2));
        x += len;
        k++;
      }
    }

    // Kitchen tiles under the counter area.
    for (let ty = 3; ty < 6; ty++)
      for (let tx = 17; tx < 23; tx++) {
        const light = (tx + ty) % 2 === 0;
        R(tx * TILE, ty * TILE, TILE, TILE, light ? "#efe8dc" : "#dfe9e1");
        R(tx * TILE, ty * TILE + 15, TILE, 1, "#cfc8bc");
        R(tx * TILE + 15, ty * TILE, 1, TILE, "#cfc8bc");
      }

    // Carpet under the desk block.
    if (L.desks.length) {
      const x0 = Math.min(...L.desks.map((d) => d.dx)) * TILE - 10;
      const x1 = (Math.max(...L.desks.map((d) => d.dx)) + 2) * TILE + 10;
      const y0 = Math.min(...L.desks.map((d) => d.dy)) * TILE - 10;
      const y1 = (Math.max(...L.desks.map((d) => d.dy)) + 2) * TILE + 6;
      R(x0, y0, x1 - x0, y1 - y0, "#b7bfd1");
      R(x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4, C.carpet);
      for (let yy = y0 + 4; yy < y1 - 4; yy += 4)
        for (let xx = x0 + 4 + ((yy / 4) % 2) * 2; xx < x1 - 4; xx += 4) R(xx, yy, 1, 1, C.carpetL);
    }

    // Meeting rug.
    const rx = 1 * TILE + 6;
    const ry = 4 * TILE + 6;
    const rw = 7 * TILE + 4;
    const rh = 5 * TILE + 2;
    R(rx + 2, ry, rw - 4, rh, C.rugD);
    R(rx, ry + 2, rw, rh - 4, C.rugD);
    R(rx + 3, ry + 3, rw - 6, rh - 6, C.rug);
    R(rx + 6, ry + 6, rw - 12, 1, C.rugL);
    R(rx + 6, ry + rh - 7, rw - 12, 1, C.rugL);
    R(rx + 6, ry + 6, 1, rh - 12, C.rugL);
    R(rx + rw - 7, ry + 6, 1, rh - 12, C.rugL);
    for (let i = rx + 10; i < rx + rw - 10; i += 6) {
      R(i, ry + 3, 2, 1, C.rugL);
      R(i, ry + rh - 4, 2, 1, C.rugL);
    }

    // Lounge rug.
    const lr = L.lounge.rug;
    R(lr.x, lr.y, lr.w, lr.h, "#c98b3a");
    R(lr.x + 2, lr.y + 2, lr.w - 4, lr.h - 4, "#e3a94f");
    for (let i = lr.x + 4; i < lr.x + lr.w - 4; i += 8) R(i, lr.y + lr.h / 2 - 1, 4, 2, "#f2c879");
    for (let i = lr.x + 8; i < lr.x + lr.w - 4; i += 8) {
      R(i, lr.y + 5, 2, 2, "#c98b3a");
      R(i, lr.y + lr.h - 7, 2, 2, "#c98b3a");
    }

    // Owner rug.
    const o = L.owner;
    R(o.dx * TILE - 6, (o.dy - 1) * TILE - 4, 3 * TILE + 12, 2 * TILE + 12, "#a8563f");
    R(o.dx * TILE - 4, (o.dy - 1) * TILE - 2, 3 * TILE + 8, 2 * TILE + 8, "#c46a4f");
    for (let i = 0; i < 3 * TILE + 4; i += 4) R(o.dx * TILE - 2 + i, (o.dy - 1) * TILE, 2, 1, "#e08b6c");
    for (let i = 0; i < 3 * TILE + 4; i += 4) R(o.dx * TILE - 2 + i, (o.dy + 1) * TILE + 3, 2, 1, "#e08b6c");

    // Back wall.
    R(0, 0, PW, floorTop, C.wall);
    for (let x = 0; x < PW; x += 8) R(x, 4, 3, 28, C.wallStripe);
    R(0, 0, PW, 4, C.wallTop);
    R(0, 3, PW, 1, C.wallTopL);
    R(0, 32, PW, 13, C.wains);
    R(0, 32, PW, 1, C.wainsL);
    for (let x = 4; x < PW; x += 16) {
      R(x, 35, 10, 7, C.wainsD);
      R(x + 1, 36, 8, 5, C.wains);
    }
    R(0, 45, PW, 3, C.base);
    R(0, floorTop, PW, 2, "rgba(60,30,10,0.2)");

    // Side + front walls (thin tops in 3/4 view).
    R(0, 0, 5, PH, C.wallTop);
    R(4, 0, 1, PH, C.wallTopL);
    R(PW - 5, 0, 5, PH, C.wallTop);
    R(PW - 5, 0, 1, PH, C.wallTopL);
    R(0, PH - 5, PW, 5, C.wallTop);
    R(0, PH - 5, PW, 1, C.wallTopL);
    // Doorway in the front wall.
    const doorX = 11 * TILE;
    R(doorX, PH - 5, 2 * TILE, 5, "#c79a68");
    R(doorX, PH - 5, 2 * TILE, 1, "#a77a4c");
    R(doorX - 1, PH - 5, 1, 5, C.wallTopL);
    R(doorX + 2 * TILE, PH - 5, 1, 5, C.wallTopL);
    R(doorX + 6, PH - 9, 20, 3, "#7f9a6b"); // doormat
    R(doorX + 7, PH - 8, 18, 1, "#93ad80");

    // Whiteboard frame (title text is a DOM overlay).
    const wb = L.whiteboard;
    R(wb.x - 2, wb.y - 2, wb.w + 4, wb.h + 4, "#8a8f99");
    R(wb.x - 1, wb.y - 1, wb.w + 2, wb.h + 2, "#c7ccd4");
    R(wb.x, wb.y, wb.w, wb.h, "#fbfcfd");
    R(wb.x, wb.y + wb.h - 3, wb.w, 1, "#e9ecf0");
    // Doodles: a tiny bar chart and an arrow, below the title.
    const bx = wb.x + 6;
    const by = wb.y + wb.h - 5;
    [4, 7, 6, 10].forEach((h, i) => R(bx + i * 4, by - h, 3, h, ["#60a5fa", "#34d399", "#f59e0b", "#f472b6"][i]));
    R(bx + 20, by - 1, 30, 1, "#94a3b8");
    for (let i = 0; i < 14; i++) R(wb.x + wb.w - 34 + i * 2, by - 3 - Math.round(i * 0.5 + Math.sin(i) * 1.2), 2, 1, "#ef4444");
    R(wb.x + wb.w - 7, by - 11, 2, 2, "#ef4444");
    // Marker tray.
    R(wb.x + 8, wb.y + wb.h + 2, wb.w - 16, 2, "#9aa1ab");
    R(wb.x + 14, wb.y + wb.h + 1, 5, 1, "#3b82f6");
    R(wb.x + 21, wb.y + wb.h + 1, 5, 1, "#ef4444");
    R(wb.x + 28, wb.y + wb.h + 1, 5, 1, "#111827");

    // Upper cabinets above the counter.
    const cx = L.counter.x * TILE;
    R(cx, 6, 48, 18, C.woodD);
    R(cx + 1, 7, 46, 16, C.wood);
    R(cx + 24, 7, 1, 16, C.woodD);
    R(cx + 20, 13, 2, 4, "#e8d3a8");
    R(cx + 27, 13, 2, 4, "#e8d3a8");
    R(cx, 23, 48, 2, "rgba(0,0,0,0.15)");

    // A framed picture between the cabinets and the windows.
    const fx = 11 * TILE - 4;
    R(fx, 10, 14, 12, "#6e452c");
    R(fx + 1, 11, 12, 10, "#bfe0f2");
    R(fx + 1, 17, 12, 4, "#7fb77e");
    R(fx + 3, 13, 3, 3, "#fde68a");
    R(fx + 7, 15, 4, 2, "#5f9d5e");

    return c;
  }

  /** The light of the hour, from the clock; the lights go down while the team rests. */
  private light(): Light {
    if (this.resting) return { ...NIGHT, tint: "#6b72a3", beam: 0.15 };
    const d = new Date();
    const h = this.hourOverride ?? d.getHours() + d.getMinutes() / 60;
    let i = 0;
    while (i < LIGHT_KEYS.length - 2 && h >= LIGHT_KEYS[i + 1][0]) i++;
    const [h0, a] = LIGHT_KEYS[i];
    const [h1, b] = LIGHT_KEYS[i + 1];
    const f = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
    const n = (k: "beam" | "slant" | "night") => a[k] + (b[k] - a[k]) * f;
    return {
      tint: mix(a.tint, b.tint, f),
      sun: mix(a.sun, b.sun, f),
      beam: n("beam"),
      slant: n("slant"),
      night: n("night"),
      skyTop: mix(a.skyTop, b.skyTop, f),
      skyBot: mix(a.skyBot, b.skyBot, f),
      land: mix(a.land, b.land, f),
    };
  }

  private drawWindows(ctx: CanvasRenderingContext2D) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    for (const wx of this.L.windows) {
      const x = wx * TILE + 2;
      const y = 7;
      const w = 28;
      const h = 23;
      R(x - 2, y - 2, w + 4, h + 4, "#f8f3ea");
      R(x - 2, y + h + 1, w + 4, 2, "#d9cbb4");
      const lt = this.light();
      const dark = lt.night > 0.55;
      for (let i = 0; i < h; i++) R(x, y + i, w, 1, mix(lt.skyTop, lt.skyBot, i / (h - 1)));
      if (dark) {
        for (let i = 0; i < 6; i++) {
          const sx = x + ((hashStr(`s${wx}${i}`) % w) | 0);
          const sy = y + ((hashStr(`t${wx}${i}`) % (h - 6)) | 0);
          if (Math.sin(this.t * 2 + i) > -0.6) R(sx, sy, 1, 1, "#fef9c3");
        }
        if (wx === this.L.windows[0]) R(x + 18, y + 4, 4, 4, "#fef3c7");
      } else {
        // Drifting clouds.
        const off = (this.t * 2 + wx * 13) % (w + 20);
        const cxp = x + off - 12;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        R(cxp, y + 6, 10, 3, "#ffffff");
        R(cxp + 2, y + 4, 5, 2, "#ffffff");
        R(cxp + 14, y + 13, 8, 2, "rgba(255,255,255,0.8)");
        ctx.restore();
        // Distant city/trees silhouette.
      }
      if (!dark && lt.beam > 0.3 && wx === this.L.windows[this.L.windows.length - 1]) {
        // The sun, sinking as the day goes on.
        const sy = y + 3 + Math.round(Math.max(0, -lt.slant) * 7);
        R(x + 19, sy, 4, 4, mix(lt.sun, "#ffffff", 0.4));
        R(x + 18, sy + 1, 6, 2, mix(lt.sun, "#ffffff", 0.4));
      }
      R(x, y + h - 5, w, 5, lt.land);
      for (let i = 0; i < w; i += 5) R(x + i, y + h - 7 - (i % 3), 4, 3, shade(lt.land, -0.12));
      R(x + w / 2 - 1, y, 2, h, "#f8f3ea");
      R(x, y + h / 2 - 1, w, 2, "#f8f3ea");
      // Curtains.
      R(x - 4, y - 3, 4, h + 4, "#d97a5b");
      R(x + w, y - 3, 4, h + 4, "#d97a5b");
      R(x - 4, y - 3, 1, h + 4, "#b9603f");
      R(x + w + 3, y - 3, 1, h + 4, "#b9603f");
    }
  }

  private drawClock(ctx: CanvasRenderingContext2D) {
    const cx = this.L.clockX * TILE + 8;
    const cy = 18;
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    R(cx - 5, cy - 7, 10, 14, C.woodDD);
    R(cx - 6, cy - 6, 12, 12, C.woodDD);
    R(cx - 5, cy - 5, 10, 10, "#fffaf0");
    R(cx - 4, cy - 6, 8, 1, "#fffaf0");
    R(cx - 4, cy + 5, 8, 1, "#fffaf0");
    const d = new Date();
    const hAng = ((d.getHours() % 12) + d.getMinutes() / 60) * (Math.PI / 6);
    const mAng = d.getMinutes() * (Math.PI / 30);
    for (let i = 1; i <= 3; i++) R(cx + Math.round(Math.sin(hAng) * i), cy - Math.round(Math.cos(hAng) * i), 1, 1, "#1f2937");
    for (let i = 1; i <= 4; i++) R(cx + Math.round(Math.sin(mAng) * i), cy - Math.round(Math.cos(mAng) * i), 1, 1, "#ef4444");
    R(cx, cy, 1, 1, "#1f2937");
  }

  private drawDesk(ctx: CanvasRenderingContext2D, a: Actor) {
    const X = a.slot.dx * TILE;
    const Y = a.slot.dy * TILE;
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const col = a.tm.color;
    const st = a.tm.state;
    // Shadow, legs, top, front.
    R(X + 1, Y + 14, 30, 3, C.shadow);
    R(X + 1, Y + 10, 2, 6, C.woodDD);
    R(X + 29, Y + 10, 2, 6, C.woodDD);
    R(X, Y + 1, 32, 9, C.wood);
    R(X, Y + 1, 32, 1, C.woodL);
    R(X, Y + 10, 32, 3, C.woodD);
    R(X + 3, Y + 13, 26, 1, C.woodDD);

    // Desk deco by seed (left side).
    const deco = a.seed % 4;
    if (deco === 0) {
      // Potted succulent.
      R(X + 3, Y + 4, 5, 4, "#c0603e");
      R(X + 3, Y + 4, 5, 1, "#d97a5b");
      R(X + 4, Y + 1, 3, 3, "#4f9d5e");
      R(X + 3, Y + 2, 1, 2, "#6fbf7a");
      R(X + 7, Y + 2, 1, 2, "#6fbf7a");
    } else if (deco === 1) {
      // Mug with teammate color.
      R(X + 3, Y + 4, 4, 4, col);
      R(X + 7, Y + 5, 1, 2, col);
      R(X + 3, Y + 4, 4, 1, shade(col, 0.4));
    } else if (deco === 2) {
      // Book stack.
      R(X + 2, Y + 6, 7, 2, "#3b82f6");
      R(X + 3, Y + 4, 6, 2, "#f59e0b");
      R(X + 2, Y + 2, 7, 2, "#10b981");
    } else {
      // Photo frame.
      R(X + 3, Y + 2, 6, 6, "#4b3a2a");
      R(X + 4, Y + 3, 4, 4, "#fde68a");
      R(X + 5, Y + 5, 2, 2, "#f472b6");
    }
    // Papers (right side) and keyboard.
    R(X + 25, Y + 4, 5, 5, "#ffffff");
    R(X + 26, Y + 5, 3, 1, "#cbd5e1");
    R(X + 26, Y + 7, 2, 1, "#cbd5e1");
    R(X + 10, Y + 7, 12, 3, "#5b6170");
    R(X + 11, Y + 7, 10, 2, "#e5e7eb");
    for (let i = 0; i < 5; i++) R(X + 11 + i * 2, Y + 8, 1, 1, "#9ca3af");
    R(X + 23, Y + 8, 2, 2, "#e5e7eb");

    // Monitor: stand + frame + screen.
    R(X + 12, Y + 5, 8, 2, "#3f4454");
    R(X + 15, Y + 2, 2, 3, "#3f4454");
    R(X + 7, Y - 9, 18, 12, C.dark);
    R(X + 7, Y - 9, 18, 1, "#40435a");
    const sx = X + 8;
    const sy = Y - 8;
    const sw = 16;
    const sh = 9;
    const t = this.t;
    if (st === "working") {
      R(sx, sy, sw, sh, shade(col, -0.6));
      const scroll = Math.floor(t * 4 + a.seed);
      for (let i = 0; i < 4; i++) {
        const lw = 3 + ((hashStr(`${a.id}${scroll + i}`) % 10) | 0);
        const ind = (hashStr(`i${scroll + i}`) % 3) * 2;
        R(sx + 1 + ind, sy + 1 + i * 2, Math.min(lw, sw - 2 - ind), 1, i % 2 ? shade(col, 0.45) : col);
      }
      if (Math.floor(t * 2) % 2 === 0) R(sx + 1, sy + 7, 2, 1, "#ffffff");
      if (Math.sin(t * 23 + a.seed) > 0.85) R(sx, sy, sw, sh, "rgba(255,255,255,0.12)");
    } else if (st === "waiting") {
      R(sx, sy, sw, sh, "#3a2a05");
      if (Math.floor(t * 3) % 2 === 0) {
        R(sx + 7, sy + 1, 2, 5, "#f59e0b");
        R(sx + 7, sy + 7, 2, 1, "#f59e0b");
      }
    } else if (st === "error") {
      const flick = Math.sin(t * 17) > 0;
      R(sx, sy, sw, sh, flick ? "#7f1d1d" : "#991b1b");
      for (let i = 0; i < 5; i++) {
        R(sx + 5 + i, sy + 2 + i, 1, 1, "#fecaca");
        R(sx + 9 - i, sy + 2 + i, 1, 1, "#fecaca");
      }
    } else {
      R(sx, sy, sw, sh, "#1c2131");
      // Screensaver: a little bouncing square in their color.
      const px = Math.round((Math.sin(t * 0.9 + a.seed) * 0.5 + 0.5) * (sw - 3));
      const py = Math.round((Math.cos(t * 1.3 + a.seed) * 0.5 + 0.5) * (sh - 3));
      R(sx + px, sy + py, 2, 2, rgba(col, 0.8));
    }
    R(sx, sy, sw, 1, "rgba(255,255,255,0.08)");
    R(X + 23, Y + 1, 1, 1, st === "working" ? "#4ade80" : st === "error" ? "#ef4444" : st === "waiting" ? "#f59e0b" : "#64748b");
  }

  private drawChairEmpty(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    const R = (xx: number, yy: number, w: number, h: number, col: string) => this.rect(ctx, xx, yy, w, h, col);
    R(x - 5, y - 1, 10, 2, C.shadow);
    R(x - 1, y - 3, 2, 3, "#2f333d");
    R(x - 6, y - 11, 12, 4, shade(color, -0.15));
    R(x - 6, y - 11, 12, 1, shade(color, 0.15));
    this.chairBack(ctx, x, y, color);
  }

  /** The backrest seen from behind: drawn over a teammate sitting with their back to us. */
  private chairBack(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    const R = (xx: number, yy: number, w: number, h: number, col: string) => this.rect(ctx, xx, yy, w, h, col);
    R(x - 6, y - 6, 12, 5, C.chair);
    R(x - 5, y - 6, 10, 1, C.chairL);
    R(x - 5, y - 5, 10, 3, shade(color, -0.35));
    R(x - 1, y - 2, 2, 2, "#2f333d");
    R(x - 5, y, 3, 1, "#1f2229");
    R(x + 2, y, 3, 1, "#1f2229");
  }

  /** Backrest behind a teammate facing the viewer. */
  private chairFront(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    const R = (xx: number, yy: number, w: number, h: number, col: string) => this.rect(ctx, xx, yy, w, h, col);
    R(x - 5, y - 1, 10, 2, C.shadow);
    R(x - 6, y - 20, 12, 12, C.chair);
    R(x - 5, y - 19, 10, 10, shade(color, -0.35));
    R(x - 5, y - 19, 10, 1, shade(color, -0.1));
    R(x - 7, y - 8, 14, 4, shade(color, -0.15));
    R(x - 1, y - 4, 2, 3, "#2f333d");
    R(x - 5, y - 1, 3, 1, "#1f2229");
    R(x + 2, y - 1, 3, 1, "#1f2229");
  }

  private frameFor(a: Actor): { key: FrameKey; seatedChair: "front" | "back" | null; dy: number } {
    const blink = this.t < a.blinkUntil;
    if (a.moving) {
      const f = Math.floor(a.walkT * STEP_FPS) % 4;
      const kind = f === 0 ? "walkA" : f === 2 ? "walkB" : "stand";
      return { key: `${kind}_${a.dir}` as FrameKey, seatedChair: null, dy: f % 2 === 1 ? 0 : -1 };
    }
    if (this.napping(a)) return { key: "sit_up_slump", seatedChair: "back", dy: 0 };
    if (this.atSeat(a)) {
      switch (a.tm.state) {
        case "working": {
          const typing = this.t > a.typePauseUntil;
          const k = typing ? (Math.floor(this.t * 9) % 2 ? "sit_up_typeA" : "sit_up_typeB") : "sit_up_typeA";
          return { key: k, seatedChair: "back", dy: 0 };
        }
        case "error":
          return { key: "sit_up_slump", seatedChair: "back", dy: 0 };
        case "waiting":
          return { key: blink ? "blink_down" : "stand_down", seatedChair: null, dy: 3 };
        default: {
          if (this.t < a.stretchUntil) return { key: "sit_down_stretch", seatedChair: "front", dy: 0 };
          return { key: blink ? "sit_down_blink" : "sit_down", seatedChair: "front", dy: 0 };
        }
      }
    }
    if (a.sitting) return { key: blink ? "sit_down_blink" : "sit_down", seatedChair: null, dy: 0 };
    if (a.holding && a.dir !== "up") return { key: `hold_${a.dir}` as FrameKey, seatedChair: null, dy: 0 };
    if (a.dir === "down" && blink) return { key: "blink_down", seatedChair: null, dy: 0 };
    return { key: `stand_${a.dir}` as FrameKey, seatedChair: null, dy: 0 };
  }

  private drawActor(ctx: CanvasRenderingContext2D, a: Actor) {
    const { key, seatedChair, dy } = this.frameFor(a);
    const x = Math.round(a.x) + this.wobble(a);
    const y = Math.round(a.y) + dy;
    const col = a.tm.color;
    if (seatedChair === "front") this.chairFront(ctx, a.slot.seatX, a.slot.seatY, col);

    const selected = this.selectedId === a.id;
    const hovered = this.hoverId === a.id;
    if (!seatedChair && !a.sitting) this.rect(ctx, x - 5, Math.round(a.y) - 1 + (a.tm.state === "waiting" && this.atSeat(a) ? 3 : 0), 10, 2, C.shadow);
    if (selected) {
      const pulse = 0.55 + Math.sin(this.t * 4) * 0.25;
      ctx.fillStyle = rgba(col, pulse);
      const fy = Math.round(a.y) + (seatedChair ? 1 : dy);
      ctx.fillRect(x - 7, fy, 14, 1);
      ctx.fillRect(x - 8, fy - 1, 1, 1);
      ctx.fillRect(x + 7, fy - 1, 1, 1);
      ctx.fillRect(x - 6, fy + 1, 12, 1);
    }
    const img = a.sheet.frames.get(key);
    const glow = a.sheet.glow.get(key);
    const ox = x - SPR_AX;
    const oy = y - SPR_AY;
    if ((hovered || selected) && glow) {
      ctx.globalAlpha = hovered ? 0.95 : 0.7;
      ctx.drawImage(glow, ox - 1, oy);
      ctx.drawImage(glow, ox + 1, oy);
      ctx.drawImage(glow, ox, oy - 1);
      ctx.drawImage(glow, ox, oy + 1);
      ctx.globalAlpha = 1;
    }
    if (img) ctx.drawImage(img, ox, oy);
    if (seatedChair === "back") this.chairBack(ctx, a.slot.seatX, a.slot.seatY, col);
    // A coffee mug in hand.
    if (a.holding && !seatedChair) {
      const mx = a.dir === "left" ? x - 6 : a.dir === "right" ? x + 3 : x + 2;
      if (a.dir !== "up") {
        this.rect(ctx, mx, y - 11, 3, 3, "#ffffff");
        this.rect(ctx, mx, y - 11, 3, 1, "#7c4a2a");
      }
    }
  }

  private drawShelf(ctx: CanvasRenderingContext2D) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const X = this.L.shelf.x * TILE;
    const B = 4 * TILE; // bottom
    const top = B - 44;
    R(X + 1, B - 2, 30, 3, C.shadow);
    R(X, top, 32, 44, C.woodDD);
    R(X + 2, top + 2, 28, 40, "#5a3a25");
    // Shelves.
    const shelfYs = [top + 13, top + 26, top + 39];
    for (const sy of shelfYs) R(X + 2, sy, 28, 2, C.woodD);
    R(X, top, 32, 2, C.woodL);
    // Label plate "WORK".
    R(X + 6, top - 7, 20, 8, "#d4a94e");
    R(X + 7, top - 6, 18, 6, "#f3d27a");
    let lx = X + 8;
    for (const ch of "WORK") {
      drawMap(ctx, FONT3[ch], lx, top - 6 + 0, { o: "#5a3a25" });
      lx += 4;
    }
    // Binders: one per deliverable, filling shelves left-to-right, bottom-up.
    const count = Math.max(0, this.deliverables - this.docsInFlight);
    const perShelf = 9;
    const max = perShelf * 3;
    const shown = Math.min(count, max);
    const bump = this.shelfBump > 0 ? Math.round(Math.sin(this.shelfBump * 18) * 1) : 0;
    for (let i = 0; i < shown; i++) {
      const s = 2 - Math.floor(i / perShelf);
      const k = i % perShelf;
      const h = 9 + (hashStr(`b${i}`) % 3);
      const bx = X + 3 + k * 3;
      const by = shelfYs[s] - h + (i === shown - 1 ? bump : 0);
      const c = BINDER_COLORS[hashStr(`c${i}`) % BINDER_COLORS.length];
      R(bx, by, 3, h, c);
      R(bx, by, 1, h, shade(c, 0.25));
      R(bx + 1, by + 2, 1, 2, "#ffffff");
    }
    if (count === 0) {
      // A lonely plant until work arrives.
      R(X + 12, shelfYs[2] - 5, 6, 5, "#c0603e");
      R(X + 13, shelfYs[2] - 9, 4, 4, "#4f9d5e");
    }
  }

  private drawCounter(ctx: CanvasRenderingContext2D) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const X = this.L.counter.x * TILE;
    const B = 4 * TILE;
    R(X, B - 2, 48, 3, C.shadow);
    R(X, B - 22, 48, 21, "#e9e2d6");
    R(X + 1, B - 20, 22, 17, "#d8cfc0");
    R(X + 25, B - 20, 22, 17, "#d8cfc0");
    R(X + 20, B - 13, 2, 3, "#8a8f99");
    R(X + 26, B - 13, 2, 3, "#8a8f99");
    R(X - 1, B - 25, 50, 4, "#7a7f8a");
    R(X - 1, B - 25, 50, 1, "#a1a6b0");
    // Coffee machine.
    R(X + 3, B - 44, 14, 20, "#2d2f36");
    R(X + 4, B - 43, 12, 3, "#454852");
    R(X + 6, B - 38, 8, 6, "#16171b");
    R(X + 7, B - 37, 6, 1, "#3c3f47");
    R(X + 14, B - 42, 1, 1, Math.floor(this.t * 2) % 2 ? "#ef4444" : "#7f1d1d");
    R(X + 8, B - 30, 4, 4, "#ffffff");
    R(X + 12, B - 29, 1, 2, "#ffffff");
    R(X + 8, B - 30, 4, 1, "#7c4a2a");
    // Mugs + fruit bowl.
    R(X + 21, B - 29, 3, 4, "#60a5fa");
    R(X + 25, B - 29, 3, 4, "#f472b6");
    R(X + 33, B - 28, 11, 3, "#c9b28d");
    R(X + 34, B - 31, 3, 3, "#ef4444");
    R(X + 37, B - 32, 3, 3, "#f59e0b");
    R(X + 40, B - 31, 3, 3, "#84cc16");
  }

  private drawCooler(ctx: CanvasRenderingContext2D) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const X = this.L.cooler.x * TILE + 3;
    const B = 4 * TILE;
    R(X - 1, B - 2, 12, 3, C.shadow);
    R(X, B - 24, 10, 23, "#f1f3f6");
    R(X, B - 24, 10, 1, "#ffffff");
    R(X + 8, B - 24, 2, 23, "#d6dbe2");
    R(X + 3, B - 18, 4, 2, "#60a5fa");
    R(X + 3, B - 15, 4, 1, "#ef4444");
    R(X + 1, B - 38, 8, 14, "#93c5fd");
    R(X + 2, B - 40, 6, 2, "#60a5fa");
    R(X + 2, B - 36, 2, 9, "#bfdbfe");
    const bub = Math.floor(this.t * 1.5) % 10;
    R(X + 5, B - 26 - bub, 1, 1, "#eff6ff");
  }

  private drawPlant(ctx: CanvasRenderingContext2D, X: number, Y: number) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    R(X + 2, Y + 14, 12, 3, C.shadow);
    const sway = Math.round(Math.sin(this.t * 1.2 + X) * 0.6);
    drawMap(ctx, PLANT, X + 1 + sway, Y - 6, { g: "#4f9d5e", G: "#7cc58a", d: "#3a7a47" });
    R(X + 4, Y + 5, 8, 10, "#c0603e");
    R(X + 3, Y + 4, 10, 2, "#d97a5b");
    R(X + 5, Y + 7, 1, 6, "#d97a5b");
  }

  private addMeeting(list: { y: number; draw: () => void }[]) {
    const m = this.L.meeting;
    const X = m.x * TILE;
    const Y = m.y * TILE;
    const w = m.w * TILE;
    const ctx = this.wctx;
    const R = (x: number, y: number, ww: number, h: number, col: string) => this.rect(ctx, x, y, ww, h, col);
    const chairCol = "#5f8f9e";
    const stool = (cx: number, cy: number, back: "north" | "south" | "side") => () => {
      R(cx - 5, cy - 1, 10, 2, C.shadow);
      if (back === "north") {
        R(cx - 5, cy - 14, 10, 7, shade(chairCol, -0.3));
        R(cx - 4, cy - 13, 8, 1, chairCol);
      }
      R(cx - 5, cy - 7, 10, 5, chairCol);
      R(cx - 5, cy - 7, 10, 1, shade(chairCol, 0.25));
      R(cx - 4, cy - 2, 1, 2, "#3f4454");
      R(cx + 3, cy - 2, 1, 2, "#3f4454");
      if (back === "south") {
        R(cx - 5, cy - 6, 10, 5, shade(chairCol, -0.3));
        R(cx - 4, cy - 6, 8, 1, chairCol);
      }
    };
    for (const cx of [X + 10, X + 32, X + 54]) list.push({ y: Y - 1, draw: stool(cx, Y + 2, "north") });
    list.push({ y: Y + 20, draw: stool(X - 6, Y + 22, "side") });
    list.push({ y: Y + 20, draw: stool(X + w + 6, Y + 22, "side") });
    list.push({
      y: Y + 30,
      draw: () => {
        R(X + 2, Y + 28, w - 4, 4, C.shadow);
        R(X + 3, Y + 18, 3, 12, C.woodDD);
        R(X + w - 6, Y + 18, 3, 12, C.woodDD);
        R(X, Y - 2, w, 22, "#a8714a");
        R(X, Y - 2, w, 1, "#c48f5f");
        R(X + 1, Y - 1, w - 2, 19, "#b98057");
        R(X, Y + 20, w, 4, "#7c4f31");
        // Table stuff: laptop, notes, plant, mugs.
        R(X + 8, Y + 3, 12, 8, "#9aa3b2");
        R(X + 9, Y + 4, 10, 6, "#c7cdd8");
        R(X + 13, Y + 6, 2, 2, "#ffffff");
        R(X + 26, Y + 6, 8, 9, "#fef9c3");
        R(X + 27, Y + 8, 6, 1, "#e5d89a");
        R(X + 27, Y + 10, 4, 1, "#e5d89a");
        R(X + 36, Y + 4, 7, 7, "#fda4af");
        R(X + 37, Y + 6, 5, 1, "#f87171");
        R(X + 48, Y + 4, 5, 5, "#c0603e");
        R(X + 49, Y + 1, 3, 3, "#4f9d5e");
        R(X + 47, Y + 2, 1, 2, "#7cc58a");
        R(X + 53, Y + 2, 1, 2, "#7cc58a");
        R(X + 24, Y + 14, 3, 3, "#ffffff");
        R(X + 44, Y + 13, 3, 3, "#fde68a");
      },
    });
    for (const cx of [X + 10, X + 32, X + 54]) list.push({ y: Y + 41, draw: stool(cx, Y + 42, "south") });
  }

  private drawOwnerChair(ctx: CanvasRenderingContext2D) {
    const o = this.L.owner;
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const x = o.seatX;
    const y = o.seatY;
    R(x - 6, y - 1, 12, 2, C.shadow);
    R(x - 7, y - 22, 14, 15, "#3b2a24");
    R(x - 6, y - 21, 12, 13, "#5a3d33");
    R(x - 5, y - 20, 10, 1, "#7a5446");
    R(x - 8, y - 8, 16, 5, "#5a3d33");
    R(x - 8, y - 8, 16, 1, "#7a5446");
    R(x - 1, y - 3, 2, 3, "#2f333d");
    R(x - 6, y - 1, 4, 1, "#1f2229");
    R(x + 2, y - 1, 4, 1, "#1f2229");
  }

  private drawOwnerDesk(ctx: CanvasRenderingContext2D) {
    const o = this.L.owner;
    const X = o.dx * TILE;
    const Y = o.dy * TILE;
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    R(X + 1, Y + 14, 46, 3, C.shadow);
    R(X, Y + 1, 48, 10, "#8a5a3b");
    R(X, Y + 1, 48, 1, "#a8714a");
    R(X, Y + 11, 48, 5, "#6e452c");
    R(X + 4, Y + 12, 40, 3, "#5a3a25");
    R(X + 22, Y + 12, 4, 1, "#d4a94e");
    // Laptop seen from the back + lamp.
    R(X + 16, Y - 3, 14, 9, "#9aa3b2");
    R(X + 16, Y - 3, 14, 1, "#c7cdd8");
    R(X + 22, Y + 0, 2, 2, "#e5e7eb");
    R(X + 15, Y + 6, 16, 2, "#7d8594");
    R(X + 4, Y - 6, 2, 10, "#3f4454");
    R(X + 2, Y - 9, 7, 4, "#f59e0b");
    R(X + 3, Y - 5, 5, 1, "#fde68a");
    // Inbox tray with one paper per pending approval.
    const tx = X + 34;
    const ty = Y + 2;
    const papers = Math.min(6, Math.max(0, this.pending - this.papersInFlight));
    const bump = this.inboxBump > 0 ? -1 : 0;
    R(tx, ty + 4, 12, 4, "#9aa3b2");
    for (let i = 0; i < papers; i++) {
      R(tx + 1, ty + 3 - i + bump, 10, 1, i % 2 ? "#ffffff" : "#f1f5f9");
    }
    R(tx, ty + 4, 12, 1, "#c7cdd8");
    R(tx + 1, ty + 7, 10, 1, "#7d8594");
    if (papers > 0 && Math.floor(this.t * 2) % 2 === 0) R(tx + 11, ty - 1 - papers, 2, 2, "#f59e0b");
  }

  private drawSofa(ctx: CanvasRenderingContext2D) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const X = this.L.lounge.sofaX * TILE;
    const Y = this.L.lounge.y * TILE;
    const c = "#4f7cac";
    const cd = shade(c, -0.3);
    const cl = shade(c, 0.2);
    R(X + 1, Y + 13, 46, 3, C.shadow);
    R(X + 1, Y - 10, 46, 12, cd); // backrest
    R(X + 2, Y - 9, 44, 1, c);
    R(X + 4, Y - 7, 19, 8, c);
    R(X + 25, Y - 7, 19, 8, c);
    R(X + 5, Y - 7, 17, 1, cl);
    R(X + 26, Y - 7, 17, 1, cl);
    R(X, Y, 48, 9, c); // seat
    R(X + 3, Y, 42, 1, cl);
    R(X + 23, Y + 1, 1, 6, cd);
    R(X, Y + 9, 48, 4, cd);
    R(X - 1, Y - 4, 5, 15, cd); // arms
    R(X + 44, Y - 4, 5, 15, cd);
    R(X - 1, Y - 4, 5, 1, c);
    R(X + 44, Y - 4, 5, 1, c);
    // Cushions.
    R(X + 6, Y - 3, 7, 5, "#f2c879");
    R(X + 35, Y - 3, 7, 5, "#f29a9a");
    R(X + 2, Y + 13, 2, 2, C.woodDD);
    R(X + 44, Y + 13, 2, 2, C.woodDD);
  }

  private drawLoungeSide(ctx: CanvasRenderingContext2D) {
    const R = (x: number, y: number, w: number, h: number, col: string) => this.rect(ctx, x, y, w, h, col);
    const Lg = this.L.lounge;
    // Side table with a lamp and books.
    const tx = (Lg.sofaX - 1) * TILE + 2;
    const ty = Lg.y * TILE;
    R(tx, ty + 12, 12, 3, C.shadow);
    R(tx, ty + 2, 12, 4, C.wood);
    R(tx, ty + 2, 12, 1, C.woodL);
    R(tx + 1, ty + 6, 10, 7, C.woodD);
    R(tx + 2, ty + 8, 8, 1, C.woodDD);
    R(tx + 5, ty - 6, 2, 8, "#3f4454");
    R(tx + 2, ty - 12, 8, 6, "#fde68a");
    R(tx + 2, ty - 12, 8, 1, "#fff7c2");
    R(tx + 3, ty - 7, 6, 1, "#e5c063");
    // Armchair.
    const ax = (Lg.sofaX + 4) * TILE;
    const c = "#c46a4f";
    R(ax + 1, ty + 13, 14, 3, C.shadow);
    R(ax + 1, ty - 8, 14, 10, shade(c, -0.25));
    R(ax + 3, ty - 6, 10, 6, c);
    R(ax, ty, 16, 9, c);
    R(ax + 2, ty, 12, 1, shade(c, 0.2));
    R(ax, ty + 9, 16, 4, shade(c, -0.25));
    R(ax - 1, ty - 3, 3, 13, shade(c, -0.3));
    R(ax + 14, ty - 3, 3, 13, shade(c, -0.3));
  }

  private stepCat(dt: number) {
    if (!this.cat) {
      const start = this.L.lounge;
      this.cat = {
        sheet: buildCat(),
        x: (start.sofaX + 3) * TILE + 8,
        y: (start.y + 1) * TILE + 12,
        dir: "left",
        path: [],
        mode: "sleep",
        until: this.t + 8,
        walkT: 0,
        nextZ: 0,
      };
    }
    const cat = this.cat;
    if (cat.mode === "walk") {
      let budget = 22 * dt;
      while (budget > 0 && cat.path.length) {
        const wp = cat.path[0];
        const dx = wp.x - cat.x;
        const dy = wp.y - cat.y;
        const d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.2) cat.dir = dx > 0 ? "right" : "left";
        if (d <= budget) {
          cat.x = wp.x;
          cat.y = wp.y;
          budget -= d;
          cat.path.shift();
        } else {
          cat.x += (dx / d) * budget;
          cat.y += (dy / d) * budget;
          budget = 0;
        }
      }
      cat.walkT += dt;
      if (!cat.path.length) {
        const nap = Math.random() < 0.5;
        cat.mode = nap ? "sleep" : "sit";
        cat.until = this.t + (nap ? 10 + Math.random() * 14 : 3 + Math.random() * 5);
      }
      return;
    }
    if (cat.mode === "sleep" && this.t > cat.nextZ) {
      cat.nextZ = this.t + 1.4;
      this.particles.push({ x: cat.x + (cat.dir === "right" ? 2 : -5), y: cat.y - 12, vx: 3, vy: -6, g: 0, life: 0, max: 1.6, color: "#ffffff", size: 1, kind: "z" });
    }
    if (this.t < cat.until) return;
    // Pick a random walkable floor tile nearby-ish and stroll there.
    const L = this.L;
    for (let tries = 0; tries < 20; tries++) {
      const tx = 1 + Math.floor(Math.random() * (L.W - 2));
      const ty = 4 + Math.floor(Math.random() * (L.H - 5));
      if (L.blocked[ty * L.W + tx]) continue;
      const tiles = findPath(L, { x: Math.floor(cat.x / TILE), y: Math.floor(cat.y / TILE) }, { x: tx, y: ty });
      if (!tiles.length) continue;
      cat.path = tiles.map((t) => ({ x: t.x * TILE + 8, y: t.y * TILE + 12 }));
      cat.mode = "walk";
      return;
    }
    cat.until = this.t + 3;
  }

  private drawCat(ctx: CanvasRenderingContext2D) {
    const cat = this.cat;
    if (!cat) return;
    const fr = cat.sheet[cat.dir];
    let img = fr.sit;
    let bottom = 12;
    if (cat.mode === "walk") {
      img = Math.floor(cat.walkT * 6) % 2 ? fr.walkA : fr.walkB;
      bottom = 11;
    } else if (cat.mode === "sleep") {
      img = fr.loaf;
      bottom = 10;
    }
    const x = Math.round(cat.x) - 8;
    const y = Math.round(cat.y) - bottom;
    this.rect(ctx, x + 3, Math.round(cat.y) - 1, 10, 2, C.shadow);
    ctx.drawImage(img, x, y);
  }

  /** Clicking the cat gets you a heart. */
  pet(ix: number, iy: number) {
    const cat = this.cat;
    if (!cat || Math.abs(ix - cat.x) > 9 || iy < cat.y - 13 || iy > cat.y + 2) return false;
    this.flyers.push({ icon: "heart", x0: cat.x, y0: cat.y - 12, x1: cat.x, y1: cat.y - 26, t: 0, dur: 1, arc: 0 });
    if (cat.mode === "sleep") cat.until = this.t + 0.6;
    return true;
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      if (p.life < 0) continue;
      const k = p.life / p.max;
      if (p.kind === "smoke") {
        const s = Math.round(3 + k * 5);
        ctx.fillStyle = rgba(p.color, 0.7 * (1 - k));
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
        ctx.fillRect(Math.round(p.x - s / 2) + 1, Math.round(p.y - s / 2) - 1, s - 2, s + 2);
      } else if (p.kind === "z") {
        ctx.globalAlpha = 1 - k;
        drawMap(ctx, ICON_Z, Math.round(p.x), Math.round(p.y), { o: "#ffffff" });
        ctx.globalAlpha = 1;
      } else if (p.kind === "steam") {
        ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
        ctx.fillRect(Math.round(p.x + Math.sin(p.life * 6) * 1), Math.round(p.y), 1, 2);
      } else if (p.kind === "spark") {
        const on = Math.sin(k * Math.PI);
        ctx.fillStyle = rgba(p.color, on);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        ctx.fillRect(x, y - 1, 1, 3);
        ctx.fillRect(x - 1, y, 3, 1);
        if (on > 0.7) {
          ctx.fillRect(x, y - 2, 1, 1);
          ctx.fillRect(x, y + 2, 1, 1);
          ctx.fillRect(x - 2, y, 1, 1);
          ctx.fillRect(x + 2, y, 1, 1);
        }
      } else {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, Math.floor(p.life * 10) % 2 ? p.size : 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawFlyers(ctx: CanvasRenderingContext2D) {
    for (const f of this.flyers) {
      const k = Math.min(1, f.t / f.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(Math.PI * k) * f.arc;
      if (f.icon === "doc") {
        drawMap(ctx, ICON_DOC, Math.round(x - 3), Math.round(y - 4), { o: "#334155", w: "#ffffff", a: "#93c5fd" });
      } else if (f.icon === "envelope") {
        // Pop in with a little scale wobble on the first frames.
        drawMap(ctx, ICON_ENVELOPE, Math.round(x - 4), Math.round(y - 3), { o: "#7c2d12", w: "#fff7ed" });
        if (k < 0.15) this.rect(ctx, x - 6, y - 6, 1, 1, "#fde68a");
      } else {
        ctx.globalAlpha = 1 - k;
        drawMap(ctx, ICON_HEART, Math.round(x - 2), Math.round(y - 2), { o: "#f43f5e" });
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Light drawn over the upscaled pixels at full screen resolution, so it stays soft while the art stays
   * crisp: contact shadows, the hour's colour, window beams with dust, lamps and screens, focus on the
   * selected teammate and a vignette. `w`/`h` are the display canvas's size.
   */
  renderHD(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const sx = w / this.world.width;
    const sy = h / this.world.height;
    const lt = this.light();
    const L = this.L;
    const blob = (x: number, y: number, rx: number, ry: number, col: string, a: number) => {
      if (a <= 0.004) return;
      ctx.save();
      ctx.translate(x * sx, y * sy);
      ctx.scale(rx * sx, ry * sy);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    ctx.save();

    // Soft contact shadows under people and furniture.
    ctx.globalCompositeOperation = "multiply";
    const ink = "#4a2a1a";
    for (const a of this.actors.values()) {
      blob(a.slot.dx * TILE + 16, a.slot.dy * TILE + 15, 21, 5, ink, 0.32);
      blob(a.x, a.y + 0.5, 8, 3, ink, a.sitting || this.atSeat(a) ? 0.2 : 0.38);
    }
    const m = L.meeting;
    blob(m.x * TILE + (m.w * TILE) / 2, m.y * TILE + 28, (m.w * TILE) / 2 + 10, 8, ink, 0.3);
    blob(L.lounge.sofaX * TILE + 24, L.lounge.y * TILE + 14, 30, 5, ink, 0.3);
    blob(L.owner.dx * TILE + 24, L.owner.dy * TILE + 15, 28, 5, ink, 0.32);
    blob(L.shelf.x * TILE + 16, 4 * TILE, 20, 4, ink, 0.3);
    blob(L.counter.x * TILE + 24, 4 * TILE, 28, 4, ink, 0.3);
    for (const p of L.plants) blob(p.x * TILE + 8, (p.y + 1) * TILE - 1, 9, 3, ink, 0.3);
    if (this.cat) blob(this.cat.x, this.cat.y, 7, 2.5, ink, 0.3);

    // The colour of the hour.
    ctx.fillStyle = lt.tint;
    ctx.fillRect(0, 0, w, h);

    // Light through the windows: a beam, then the bright window shape on the floor.
    ctx.globalCompositeOperation = "screen";
    for (const wx of L.windows) {
      const x = wx * TILE + 2;
      const len = 78;
      const lean = lt.slant * 40;
      const g = ctx.createLinearGradient(0, 30 * sy, 0, (30 + len) * sy);
      g.addColorStop(0, rgba(lt.sun, 0.4 * lt.beam));
      g.addColorStop(1, rgba(lt.sun, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x * sx, 30 * sy);
      ctx.lineTo((x + 28) * sx, 30 * sy);
      ctx.lineTo((x + 28 + lean) * sx, (30 + len) * sy);
      ctx.lineTo((x + lean) * sx, (30 + len) * sy);
      ctx.closePath();
      ctx.fill();
      // Four panes of light on the floor, sheared with the beam.
      ctx.save();
      ctx.scale(sx, sy);
      ctx.translate(x + lean * 0.35, 3 * TILE + 6);
      ctx.transform(1, 0, lt.slant * 0.7, 1, 0, 0);
      ctx.fillStyle = rgba(lt.sun, 0.3 * lt.beam);
      for (const [px, py] of [[0, 0], [15, 0], [0, 13], [15, 13]]) ctx.fillRect(px, py, 13, 11);
      ctx.restore();
    }
    for (const mt of this.motes) blob(mt.x, mt.y, 0.9, 0.9, mix(lt.sun, "#ffffff", 0.5), lt.beam * 0.7 * (0.45 + 0.55 * Math.sin(mt.phase * 2.1)));

    // Screens and lamps, stronger as the evening comes. "screen" keeps light floors from burning out.
    ctx.globalCompositeOperation = "screen";
    const n = lt.night;
    for (const a of this.actors.values()) {
      const st = a.tm.state;
      const sleeping = this.resting && st === "idle";
      const col = st === "working" ? a.tm.color : st === "waiting" ? "#f59e0b" : st === "error" ? "#ef4444" : "#64748b";
      const k = sleeping ? 0 : st === "idle" ? 0.04 + 0.08 * n : st === "error" ? (0.25 + 0.2 * n) * (0.7 + 0.3 * Math.sin(this.t * 9)) : 0.1 + 0.4 * n;
      blob(a.slot.dx * TILE + 16, a.slot.dy * TILE - 4, 30, 22, col, k);
      if (st === "working" && this.atSeat(a)) blob(a.x, a.y - 14, 10, 9, col, 0.1 + 0.2 * n);
    }
    blob(L.owner.dx * TILE + 5, L.owner.dy * TILE - 7, 40, 30, "#ffcf7a", 0.06 + 0.42 * n);
    blob((L.lounge.sofaX - 1) * TILE + 8, L.lounge.y * TILE - 9, 46, 34, "#ffcf7a", 0.05 + 0.5 * n);
    blob(L.counter.x * TILE + 17, 4 * TILE - 42, 4, 4, "#ff5a5a", 0.15 + 0.3 * n);
    for (const wx of L.windows) blob(wx * TILE + 16, 18, 30, 20, lt.sun, 0.12 * lt.beam);

    // Focus on the selected teammate.
    ctx.globalCompositeOperation = "source-over";
    const sel = this.selectedId ? this.actors.get(this.selectedId) : undefined;
    if (sel) {
      const cx = sel.x * sx;
      const cy = (sel.y - 12) * sy;
      const g = ctx.createRadialGradient(cx, cy, 34 * sx, cx, cy, 170 * sx);
      g.addColorStop(0, "rgba(20,12,30,0)");
      g.addColorStop(1, "rgba(20,12,30,0.24)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // Vignette.
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, "rgba(30,14,8,0)");
    vg.addColorStop(1, "rgba(30,14,8,0.32)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
