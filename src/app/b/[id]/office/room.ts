/**
 * Pure office floor plan, shared by the server-rendered shell (for the aspect ratio) and the canvas engine.
 * Everything is in tiles of TILE internal pixels. The back wall is rows 0..2; the floor starts at row 3.
 *
 *   x 0..8   meeting corner (rug, table, whiteboard on the wall) and the owner's desk at the bottom
 *   x 10..22 teammate desks, `cols` per row, rows 4 tiles apart
 *   row 3    against the wall: Work shelf, water cooler, coffee counter, plants
 */

export const TILE = 16;
export const ROOM_W = 24;
export const WALL_ROWS = 3;

export type Tile = { x: number; y: number };
export type DeskSlot = {
  /** Left desk tile (desks are 2 tiles wide). */
  dx: number;
  dy: number;
  /** Feet position of the seated teammate, internal px. */
  seatX: number;
  seatY: number;
  /** Where a visitor stands (right of the chair), facing left. */
  visit: Tile;
};
export type Poi = {
  tile: Tile;
  face: Dir;
  kind: "coffee" | "water" | "window" | "plant" | "shelf" | "sofa";
  /** For seats (the sofa): the exact spot to sit, reached straight from `tile`. */
  sit?: { x: number; y: number };
};
export type Dir = "down" | "up" | "left" | "right";

export type OfficeLayout = {
  W: number;
  H: number;
  cols: number;
  rows: number;
  desks: DeskSlot[];
  /** Row-major walkability, true = blocked. */
  blocked: boolean[];
  pois: Poi[];
  owner: { dx: number; dy: number; seatX: number; seatY: number };
  meeting: { x: number; y: number; w: number; h: number };
  shelf: { x: number; y: number };
  counter: { x: number; y: number };
  cooler: { x: number; y: number };
  whiteboard: { x: number; y: number; w: number; h: number };
  windows: number[];
  clockX: number;
  plants: Tile[];
  /** Lounge corner: a sofa (3 tiles, facing the viewer), an armchair, a side table and a rug. */
  lounge: { sofaX: number; y: number; rug: { x: number; y: number; w: number; h: number } };
};

function colsFor(n: number) {
  if (n <= 2) return Math.max(1, n);
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  return 4;
}

export function layoutFor(n: number): OfficeLayout {
  const cols = colsFor(n);
  const rows = Math.max(1, Math.ceil(n / cols));
  const W = ROOM_W;
  const H = Math.max(15, 4 * rows + 7);
  const blocked = new Array<boolean>(W * H).fill(false);
  const block = (x: number, y: number, w = 1, h = 1) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < W && j < H) blocked[j * W + i] = true;
  };
  block(0, 0, W, WALL_ROWS);
  block(0, 0, 1, H);
  block(W - 1, 0, 1, H);
  block(0, H - 1, W, 1);

  // Teammate desks, centered in x 10..22.
  const blockW = cols * 3 - 1;
  const startX = 10 + Math.floor((13 - blockW) / 2);
  const desks: DeskSlot[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const dx = startX + c * 3;
    const dy = 5 + r * 4;
    block(dx, dy, 2, 1);
    desks.push({ dx, dy, seatX: dx * TILE + TILE, seatY: (dy + 1) * TILE + 11, visit: { x: dx + 2, y: dy + 1 } });
  }

  // Meeting corner: table + chairs.
  const meeting = { x: 3, y: 6, w: 4, h: 2 };
  block(2, 5, 6, 4);

  // Against the back wall.
  const shelf = { x: 12, y: 3 };
  block(shelf.x, shelf.y, 2, 1);
  const cooler = { x: 17, y: 3 };
  block(cooler.x, cooler.y);
  const counter = { x: 19, y: 3 };
  block(counter.x, counter.y, 3, 1);
  const plants: Tile[] = [
    { x: 22, y: 3 },
    { x: 1, y: H - 2 },
    { x: W - 2, y: H - 2 },
    { x: 8, y: 3 },
  ];
  for (const p of plants) block(p.x, p.y);

  // Owner desk, bottom-left, the chair north of it facing the viewer.
  const ownerDy = H - 4;
  const owner = { dx: 2, dy: ownerDy, seatX: 3 * TILE + 8, seatY: (ownerDy - 1) * TILE + 11 };
  block(2, ownerDy, 3, 1);
  block(3, ownerDy - 1);

  // Lounge along the bottom, right of the doorway.
  const lounge = { sofaX: 15, y: H - 3, rug: { x: 14 * TILE - 4, y: (H - 3) * TILE - 10, w: 7 * TILE + 8, h: 2 * TILE + 4 } };
  block(lounge.sofaX, lounge.y, 3, 1);
  block(lounge.sofaX + 4, lounge.y); // armchair
  block(lounge.sofaX - 1, lounge.y); // side table + lamp

  const pois: Poi[] = [
    {
      tile: { x: lounge.sofaX + 1, y: lounge.y + 1 },
      face: "down",
      kind: "sofa",
      sit: { x: (lounge.sofaX + 1) * TILE + 8, y: lounge.y * TILE + 12 },
    },
    { tile: { x: 20, y: 4 }, face: "up", kind: "coffee" },
    { tile: { x: 17, y: 4 }, face: "up", kind: "water" },
    { tile: { x: 10, y: 4 }, face: "up", kind: "window" },
    { tile: { x: 15, y: 4 }, face: "up", kind: "window" },
    { tile: { x: 12, y: 4 }, face: "up", kind: "shelf" },
    { tile: { x: 2, y: H - 2 }, face: "left", kind: "plant" },
    { tile: { x: W - 3, y: H - 2 }, face: "right", kind: "plant" },
  ];

  return {
    W,
    H,
    cols,
    rows,
    desks,
    blocked,
    pois,
    owner,
    meeting,
    shelf,
    counter,
    cooler,
    whiteboard: { x: 1 * TILE + 8, y: 6, w: 6 * TILE, h: 30 },
    windows: [9, 14],
    clockX: 16,
    plants,
    lounge,
  };
}

/** BFS over the tile grid (4-neighbour). Returns tile centers from just after `from` to `to`, or [] if unreachable. */
export function findPath(L: OfficeLayout, from: Tile, to: Tile): Tile[] {
  const { W, H, blocked } = L;
  const idx = (t: Tile) => t.y * W + t.x;
  const inside = (t: Tile) => t.x >= 0 && t.y >= 0 && t.x < W && t.y < H;
  if (!inside(from) || !inside(to)) return [];
  const prev = new Int32Array(W * H).fill(-1);
  const start = idx(from);
  const goal = idx(to);
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (prev[ni] !== -1) continue;
      // The goal may be a blocked tile only if it's where we are going (never happens in practice).
      if (blocked[ni] && ni !== goal) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return [];
  const out: Tile[] = [];
  for (let c = goal; c !== start; c = prev[c]) out.push({ x: c % W, y: Math.floor(c / W) });
  out.reverse();
  // Drop collinear waypoints so walking reads as straight runs.
  const simplified: Tile[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = i === 0 ? from : out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if (c && (b.x - a.x === c.x - b.x) && (b.y - a.y === c.y - b.y)) continue;
    simplified.push(b);
  }
  return simplified;
}
