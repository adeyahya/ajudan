"use client";

import { Copy, Maximize, Minus, Plus, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Button, cn, IconButton } from "@/components/kit";
import { mindMapToMarkdown, newNodeId, normalizeMarkdown, parseMindMap, type MindNode } from "@/lib/context-text";

/**
 * A mind map page (kind "mindmap"): the canvas, and under it the same map as the
 * nested list teammates read. The list is the page's `body`; the canvas parses it and
 * writes it back on every edit (onSave), so either side can be edited. The page title
 * is the central topic. Layout is automatic: branches alternate right and left of the
 * centre, each side a tree. Nothing about the layout is stored, only the outline.
 */

const ROOT = "root";
const MAX_TEXT_W = 220;
const LINE_H = 20;
const PAD = { x: 12, y: 6 };
const ROOT_PAD = { x: 20, y: 12 };
const GAP = { x: 44, y: 10, root: 56 };
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

type Box = { id: string; text: string; lines: string[]; x: number; y: number; w: number; h: number; depth: number; color: string; side: 1 | -1; parent: string | null; hidden: number };
type View = { x: number; y: number; k: number };
type Editing = { id: string; draft: string; isNew: boolean; before: MindNode[] };

// ---- tree helpers (on a clone; the canvas never mutates state in place)

function locate(nodes: MindNode[], id: string, parent: MindNode | null = null): { node: MindNode; list: MindNode[]; index: number; parent: MindNode | null } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { node: nodes[i], list: nodes, index: i, parent };
    const hit = locate(nodes[i].children, id, nodes[i]);
    if (hit) return hit;
  }
  return null;
}

const contains = (node: MindNode, id: string): boolean => node.id === id || node.children.some((c) => contains(c, id));
const countAll = (nodes: MindNode[]): number => nodes.reduce((n, c) => n + 1 + countAll(c.children), 0);

// ---- measuring text (the layout needs sizes before anything is on screen)

let ctx2d: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string) {
  ctx2d ??= document.createElement("canvas").getContext("2d");
  if (!ctx2d) return { w: text.length * 7.5, lines: [text] };
  ctx2d.font = font;
  const width = (s: string) => ctx2d!.measureText(s).width;
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    // A word wider than a line breaks anywhere.
    while (width(word) > MAX_TEXT_W) {
      let cut = word.length - 1;
      while (cut > 1 && width(word.slice(0, cut)) > MAX_TEXT_W) cut--;
      if (line) lines.push(line);
      lines.push(word.slice(0, cut));
      line = "";
      word = word.slice(cut);
    }
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > MAX_TEXT_W) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line || !lines.length) lines.push(line);
  return { w: Math.ceil(Math.max(...lines.map(width), 24)), lines };
}

function layout(title: string, branches: MindNode[], collapsed: Set<string>, editing: Editing | null, placeholder: string, family: string) {
  const textOf = (n: MindNode) => (editing?.id === n.id ? editing.draft : n.text) || placeholder;
  const boxes: Box[] = [];
  const root = measure(title || placeholder, `600 16px ${family}`);
  const rw = root.w + ROOT_PAD.x * 2;
  const rh = root.lines.length * 22 + ROOT_PAD.y * 2;
  boxes.push({ id: ROOT, text: title, lines: root.lines, x: -rw / 2, y: -rh / 2, w: rw, h: rh, depth: 0, color: "var(--foreground)", side: 1, parent: null, hidden: 0 });

  const sizes = new Map<string, { w: number; h: number; lines: string[]; block: number }>();
  const size = (n: MindNode, depth: number): number => {
    const m = measure(textOf(n), `${depth === 1 ? 500 : 400} 14px ${family}`);
    const w = m.w + PAD.x * 2;
    const h = m.lines.length * LINE_H + PAD.y * 2;
    const kids = collapsed.has(n.id) ? [] : n.children;
    const under = kids.reduce((s, c) => s + size(c, depth + 1), 0) + Math.max(0, kids.length - 1) * GAP.y;
    const block = Math.max(h, under);
    sizes.set(n.id, { w, h, lines: m.lines, block });
    return block;
  };
  const place = (n: MindNode, anchor: number, top: number, side: 1 | -1, depth: number, color: string, parent: string) => {
    const s = sizes.get(n.id)!;
    const x = side > 0 ? anchor : anchor - s.w;
    boxes.push({ id: n.id, text: n.text, lines: s.lines, x, y: top + s.block / 2 - s.h / 2, w: s.w, h: s.h, depth, color, side, parent, hidden: collapsed.has(n.id) ? countAll(n.children) : 0 });
    if (collapsed.has(n.id) || !n.children.length) return;
    const under = n.children.reduce((sum, c) => sum + sizes.get(c.id)!.block, 0) + (n.children.length - 1) * GAP.y;
    let y = top + (s.block - under) / 2;
    const next = side > 0 ? x + s.w + GAP.x : x - GAP.x;
    for (const c of n.children) {
      place(c, next, y, side, depth + 1, color, n.id);
      y += sizes.get(c.id)!.block + GAP.y;
    }
  };
  const right = Math.ceil(branches.length / 2);
  const sides: [MindNode[], 1 | -1, number][] = [
    [branches.slice(0, right), 1, 0],
    [branches.slice(right), -1, right],
  ];
  for (const [list, side, offset] of sides) {
    const total = list.reduce((sum, b) => sum + size(b, 1), 0) + Math.max(0, list.length - 1) * GAP.y * 2;
    let y = -total / 2;
    list.forEach((b, i) => {
      place(b, side > 0 ? rw / 2 + GAP.root : -rw / 2 - GAP.root, y, side, 1, COLORS[(offset + i) % COLORS.length], ROOT);
      y += sizes.get(b.id)!.block + GAP.y * 2;
    });
  }
  return boxes;
}

export default function MindMap({ title, markdown, onSave, onEditTitle }: { title: string; markdown: string; onSave: (body: string) => void; onEditTitle: () => void }) {
  const t = useT();
  const [branches, setBranches] = useState<MindNode[]>(() => parseMindMap(markdown));
  const tree = useRef(branches);
  const history = useRef<MindNode[][]>([]);
  // What this canvas saved: a page refresh that brings one of these back isn't news.
  const sent = useRef(new Set([normalizeMarkdown(markdown)]));
  const [selected, setSelected] = useState<string | null>(ROOT);
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef(editing);
  useLayoutEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  const [canUndo, setCanUndo] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  // Client only (dynamic, ssr: false), so the page's font is there to measure with.
  const [family] = useState(() => getComputedStyle(document.body).fontFamily || "sans-serif");
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const [text, setText] = useState("");
  const [textFocused, setTextFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const textTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const boxes = useMemo(() => layout(title, branches, collapsed, editing, t("context.mindmap.idea"), family), [title, branches, collapsed, editing, family, t]);
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

  const show = useCallback((next: MindNode[]) => {
    tree.current = next;
    setBranches(next);
  }, []);
  /** A finished change: kept for undo, written back as the page's text. */
  const commit = useCallback(
    (next: MindNode[], before: MindNode[] = tree.current) => {
      history.current = [...history.current.slice(-99), before];
      setCanUndo(true);
      show(next);
      const md = mindMapToMarkdown(next);
      sent.current.add(normalizeMarkdown(md));
      onSave(md);
    },
    [onSave, show],
  );
  const change = (fn: (draft: MindNode[]) => void) => {
    const next = structuredClone(tree.current);
    fn(next);
    commit(next);
  };

  // A suggestion accepted elsewhere (or another tab) changed the page: show it.
  useEffect(() => {
    const incoming = normalizeMarkdown(markdown);
    if (sent.current.has(incoming) || editingRef.current) return;
    sent.current.add(incoming);
    show(parseMindMap(markdown));
  }, [markdown, show]);

  // ---- view: fit on open, wheel pans, ⌘/ctrl + wheel (or a pinch) zooms

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const all = layout(title, tree.current, collapsed, null, "", family);
    const minX = Math.min(...all.map((b) => b.x));
    const maxX = Math.max(...all.map((b) => b.x + b.w));
    const minY = Math.min(...all.map((b) => b.y));
    const maxY = Math.max(...all.map((b) => b.y + b.h));
    const k = Math.max(0.3, Math.min(1, (el.clientWidth - 64) / (maxX - minX), (el.clientHeight - 64) / (maxY - minY)));
    setView({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k });
  }, [title, collapsed, family]);

  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, []);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return;
    setView((v) => {
      const k = Math.max(0.25, Math.min(2.5, v.k * factor));
      const px = cx ?? el.clientWidth / 2;
      const py = cy ?? el.clientHeight / 2;
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the selected idea on screen (keyboard moves, new ideas).
  useEffect(() => {
    const el = box.current;
    const b = selected ? byId.get(selected) : undefined;
    if (!el || !b) return;
    setView((v) => {
      const left = v.x + b.x * v.k;
      const right = v.x + (b.x + b.w) * v.k;
      const top = v.y + b.y * v.k;
      const bottom = v.y + (b.y + b.h) * v.k;
      const dx = left < 16 ? 16 - left : right > el.clientWidth - 16 ? el.clientWidth - 16 - right : 0;
      const dy = top < 16 ? 16 - top : bottom > el.clientHeight - 16 ? el.clientHeight - 16 - bottom : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [selected, byId]);

  // ---- editing ideas

  const add = (parentId: string, after?: string) => {
    const before = tree.current;
    const next = structuredClone(before);
    const node: MindNode = { id: newNodeId(), text: "", children: [] };
    if (parentId === ROOT) {
      const at = after ? next.findIndex((n) => n.id === after) + 1 : next.length;
      next.splice(at || next.length, 0, node);
    } else {
      const hit = locate(next, parentId);
      if (!hit) return;
      const at = after ? hit.node.children.findIndex((n) => n.id === after) + 1 : hit.node.children.length;
      hit.node.children.splice(at || hit.node.children.length, 0, node);
      setCollapsed((c) => (c.has(parentId) ? new Set([...c].filter((x) => x !== parentId)) : c));
    }
    show(next);
    setSelected(node.id);
    setEditing({ id: node.id, draft: "", isNew: true, before });
  };
  const addChild = (id: string | null) => add(id ?? ROOT);
  const addSibling = (id: string | null) => {
    if (!id || id === ROOT) return add(ROOT);
    add(locate(tree.current, id)?.parent?.id ?? ROOT, id);
  };

  const finishEdit = (keep = true) => {
    const e = editingRef.current;
    if (!e) return;
    editingRef.current = null;
    setEditing(null);
    const text = e.draft.replace(/\s+/g, " ").trim();
    if (e.isNew) {
      if (!keep || !text) {
        // Back to the idea it was added next to (or under).
        const hit = locate(tree.current, e.id);
        show(e.before);
        setSelected(hit?.list[hit.index - 1]?.id ?? hit?.parent?.id ?? ROOT);
        return;
      }
      const next = structuredClone(tree.current);
      locate(next, e.id)!.node.text = text;
      return commit(next, e.before);
    }
    const hit = locate(tree.current, e.id);
    if (keep && text && hit && hit.node.text !== text) change((d) => void (locate(d, e.id)!.node.text = text));
  };

  const remove = (id: string | null) => {
    if (!id || id === ROOT) return;
    const hit = locate(tree.current, id);
    if (!hit) return;
    const after = hit.list[hit.index + 1]?.id ?? hit.list[hit.index - 1]?.id ?? hit.parent?.id ?? ROOT;
    change((d) => {
      const h = locate(d, id)!;
      h.list.splice(h.index, 1);
    });
    setSelected(after);
  };

  const undo = () => {
    const prev = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!prev) return;
    show(prev);
    const md = mindMapToMarkdown(prev);
    sent.current.add(normalizeMarkdown(md));
    onSave(md);
    if (selected && selected !== ROOT && !locate(prev, selected)) setSelected(ROOT);
  };

  const toggle = (id: string) => setCollapsed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));

  /** Move an idea (and what's under it) to be the last idea under `target`. */
  const move = (id: string, target: string) => {
    const hit = locate(tree.current, id);
    if (!hit || id === target || contains(hit.node, target) || (hit.parent?.id ?? ROOT) === target) return;
    change((d) => {
      const h = locate(d, id)!;
      h.list.splice(h.index, 1);
      if (target === ROOT) d.push(h.node);
      else locate(d, target)!.node.children.push(h.node);
    });
    if (target !== ROOT) setCollapsed((c) => new Set([...c].filter((x) => x !== target)));
  };

  // ---- keyboard (on the canvas, not while typing in an idea)

  const siblingsOf = (id: string) => {
    const b = byId.get(id);
    if (!b || !b.parent) return [];
    return boxes.filter((x) => x.parent === b.parent && x.side === b.side);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const cur = selected ?? ROOT;
    const b = byId.get(cur);
    if (mod && e.key.toLowerCase() === "z") return void (e.preventDefault(), undo());
    if (mod || e.altKey) return;
    const go = (id: string | undefined) => id && (e.preventDefault(), setSelected(id));
    switch (e.key) {
      case "Tab":
        e.preventDefault();
        return addChild(cur);
      case "Enter":
        e.preventDefault();
        return addSibling(cur);
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return remove(cur);
      case "F2":
        e.preventDefault();
        if (cur === ROOT) return onEditTitle();
        return b && setEditing({ id: cur, draft: b.text, isNew: false, before: tree.current });
      case "Escape":
        return setSelected(null);
      case "ArrowUp":
      case "ArrowDown": {
        const list = siblingsOf(cur);
        const i = list.findIndex((x) => x.id === cur);
        return go(list[i + (e.key === "ArrowUp" ? -1 : 1)]?.id);
      }
      case "ArrowRight":
      case "ArrowLeft": {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (cur === ROOT) return go(boxes.find((x) => x.parent === ROOT && x.side === dir)?.id);
        if (!b) return;
        if (b.side === dir) {
          if (collapsed.has(cur)) toggle(cur);
          return go(boxes.find((x) => x.parent === cur)?.id ?? (collapsed.has(cur) ? locate(tree.current, cur)?.node.children[0]?.id : undefined));
        }
        return go(b.parent ?? undefined);
      }
    }
    // Typing on a selected idea starts editing it with that letter.
    if (e.key.length === 1 && e.key !== " " && cur !== ROOT && b) {
      e.preventDefault();
      setEditing({ id: cur, draft: e.key, isNew: false, before: tree.current });
    } else if (e.key === " " && cur !== ROOT && b) {
      e.preventDefault();
      setEditing({ id: cur, draft: b.text, isNew: false, before: tree.current });
    }
  };

  // ---- pointer: drag the background to pan, drag an idea onto another to move it

  const gesture = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const nodeAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-node]") as HTMLElement | null)?.dataset.node ?? null;
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, textarea")) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset.node;
    if (editing) finishEdit();
    gesture.current = { kind: id ? "node" : "pan", id, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    box.current?.setPointerCapture(e.pointerId);
    box.current?.focus({ preventScroll: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    if (g.kind === "pan") return setView((v) => ({ ...v, x: g.vx + dx, y: g.vy + dy }));
    if (g.id === ROOT) return;
    const over = nodeAt(e.clientX, e.clientY);
    const dragged = locate(tree.current, g.id!)?.node;
    const ok = over && dragged && !contains(dragged, over) ? over : null;
    setDrag((d) => (d && d.id === g.id && d.over === ok ? d : { id: g.id!, over: ok }));
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "node" && !g.moved) setSelected(g.id!);
    if (g.kind === "pan" && !g.moved) setSelected(null);
    if (drag?.over) move(drag.id, drag.over);
    setDrag(null);
  };

  // ---- the list under the map

  const onText = (value: string) => {
    setText(value);
    clearTimeout(textTimer.current);
    textTimer.current = setTimeout(() => {
      const next = parseMindMap(value);
      if (normalizeMarkdown(mindMapToMarkdown(next)) === normalizeMarkdown(mindMapToMarkdown(tree.current))) return;
      commit(next);
      setSelected(ROOT);
    }, 400);
  };
  const copyText = () => void navigator.clipboard?.writeText(`# ${title}\n\n${mindMapToMarkdown(tree.current)}`).then(() => toast(t("common.copied")));

  const sel = selected ? byId.get(selected) : undefined;
  const edges = boxes.filter((b) => b.parent);

  return (
    <div className="ajudan-mind-map">
      <div
        ref={box}
        role="tree"
        aria-label={t("context.mindmap.label")}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          const id = nodeAt(e.clientX, e.clientY);
          const b = id ? byId.get(id) : undefined;
          if (!b) return;
          if (b.id === ROOT) return onEditTitle();
          setEditing({ id: b.id, draft: b.text, isNew: false, before: tree.current });
        }}
        className="relative h-[62vh] min-h-[420px] touch-none overflow-hidden rounded-lg border border-border bg-muted/30 outline-none select-none focus-visible:ring-2 focus-visible:ring-primary/40"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: `${20 * view.k}px ${20 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
            {edges.map((b) => {
              const p = byId.get(b.parent!)!;
              const x1 = b.side > 0 ? p.x + p.w : p.x;
              const y1 = p.y + p.h / 2;
              const x2 = b.side > 0 ? b.x : b.x + b.w;
              const y2 = b.y + b.h / 2;
              const mx = (x1 + x2) / 2;
              return <path key={b.id} d={`M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={b.color} strokeWidth={b.depth === 1 ? 2.5 : 1.5} strokeLinecap="round" opacity={drag?.id === b.id ? 0.3 : 0.9} />;
            })}
          </svg>
          {boxes.map((b) => (
            <Idea
              key={b.id}
              box={b}
              selected={selected === b.id}
              dropTarget={drag?.over === b.id}
              dragging={drag?.id === b.id}
              editing={editing?.id === b.id ? editing.draft : null}
              placeholder={t("context.mindmap.idea")}
              onDraft={(draft) => setEditing((e) => (e ? { ...e, draft } : e))}
              onFinish={(keep, then) => {
                finishEdit(keep);
                box.current?.focus({ preventScroll: true });
                // Straight away: keys typed next belong to the new idea.
                if (then === "child") addChild(b.id);
                if (then === "sibling") addSibling(b.id);
              }}
              onToggle={() => toggle(b.id)}
              collapseLabel={b.hidden ? t("context.mindmap.expand", { count: b.hidden }) : t("context.mindmap.collapse")}
              hasChildren={b.hidden > 0 || boxes.some((x) => x.parent === b.id)}
            />
          ))}
        </div>

        {branches.length === 0 && !editing && (
          <p className="pointer-events-none absolute inset-x-0 bottom-14 text-center text-[13px] text-muted-foreground">{t("context.mindmap.empty")}</p>
        )}

        <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 p-0.5 shadow-sm backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => addChild(selected ?? ROOT)}>
            <Plus />
            {t("context.mindmap.addIdea")}
          </Button>
          <IconButton label={t("context.mindmap.remove")} disabled={!sel || sel.id === ROOT} onClick={() => remove(selected)}>
            <Trash2 />
          </IconButton>
          <IconButton label={t("context.mindmap.undo")} shortcut="⌘Z" disabled={!canUndo} onClick={undo}>
            <Undo2 />
          </IconButton>
        </div>
        <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-lg border border-border bg-background/95 p-0.5 shadow-sm backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
          <IconButton label={t("context.mindmap.zoomOut")} onClick={() => zoomAt(1 / 1.2)}>
            <Minus />
          </IconButton>
          <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">{Math.round(view.k * 100)}%</span>
          <IconButton label={t("context.mindmap.zoomIn")} onClick={() => zoomAt(1.2)}>
            <Plus />
          </IconButton>
          <IconButton label={t("context.mindmap.fit")} onClick={fit}>
            <Maximize />
          </IconButton>
        </div>
      </div>
      <p className="mt-2 text-xs text-tertiary">{t("context.mindmap.hint")}</p>

      <div className="mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] leading-5 font-semibold">{t("context.mindmap.asText")}</h2>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-muted-foreground" onClick={copyText}>
            <Copy />
            {t("common.copy")}
          </Button>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t("context.mindmap.asTextHint")}</p>
        <div className="mt-3 rounded-lg border border-border bg-muted/30 font-mono text-[13px] leading-5">
          <div className="border-b border-border px-3 py-2 font-semibold"># {title}</div>
          <textarea
            // The list follows the map, except while the owner is typing in it.
            value={textFocused ? text : mindMapToMarkdown(branches)}
            onChange={(e) => onText(e.target.value)}
            onFocus={() => (setText(mindMapToMarkdown(tree.current)), setTextFocused(true))}
            onBlur={() => setTextFocused(false)}
            onKeyDown={(e) => {
              // Tab indents the line (two spaces) instead of leaving the box.
              if (e.key !== "Tab") return;
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
              const value = e.shiftKey ? el.value.slice(0, start) + el.value.slice(start).replace(/^ {1,2}/, "") : `${el.value.slice(0, start)}  ${el.value.slice(start)}`;
              const shift = value.length - el.value.length;
              const caret = Math.max(start, el.selectionStart + shift);
              onText(value);
              requestAnimationFrame(() => el.setSelectionRange(caret, caret));
            }}
            spellCheck={false}
            aria-label={t("context.mindmap.asText")}
            placeholder={"- …"}
            className="block min-h-24 w-full resize-none bg-transparent px-3 py-2 outline-none [field-sizing:content]"
          />
        </div>
      </div>
    </div>
  );
}

function Idea({
  box: b,
  selected,
  dropTarget,
  dragging,
  editing,
  placeholder,
  onDraft,
  onFinish,
  onToggle,
  collapseLabel,
  hasChildren,
}: {
  box: Box;
  selected: boolean;
  dropTarget: boolean;
  dragging: boolean;
  editing: string | null;
  placeholder: string;
  onDraft: (v: string) => void;
  onFinish: (keep: boolean, then?: "child" | "sibling") => void;
  onToggle: () => void;
  collapseLabel: string;
  hasChildren: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const isEditing = editing !== null;
  useLayoutEffect(() => {
    if (!isEditing) return;
    const el = input.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);
  const root = b.depth === 0;
  return (
    <div
      data-node={b.id}
      role="treeitem"
      aria-selected={selected}
      aria-level={b.depth + 1}
      className={cn(
        "group/idea absolute flex items-center transition-[box-shadow,background-color,opacity] duration-100",
        root ? "rounded-xl bg-foreground px-5 text-[16px] leading-[22px] font-semibold text-background" : "rounded-lg bg-background px-3 text-[14px] leading-5 text-foreground",
        b.depth === 1 && "border-2 font-medium",
        b.depth > 1 && "border border-border",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        dropTarget && "bg-primary-soft ring-2 ring-primary",
        dragging && "opacity-40",
        !isEditing && "cursor-default",
      )}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderColor: b.depth === 1 ? b.color : undefined }}
    >
      {isEditing ? (
        <textarea
          ref={input}
          value={editing}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => onDraft(e.target.value.replace(/\n/g, ""))}
          onBlur={() => onFinish(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            // On an empty idea, Enter and Tab just close it (it goes away).
            const then = (editing ?? "").trim() ? undefined : null;
            if (e.key === "Enter" && !e.nativeEvent.isComposing) return void (e.preventDefault(), onFinish(true, then === null || e.shiftKey ? undefined : "sibling"));
            if (e.key === "Tab") return void (e.preventDefault(), onFinish(true, then === null ? undefined : "child"));
            if (e.key === "Escape") return void (e.preventDefault(), onFinish(false));
          }}
          className="h-full w-full resize-none overflow-hidden bg-transparent py-1.5 leading-5 outline-none placeholder:text-placeholder"
        />
      ) : (
        <span className={cn("whitespace-pre", !b.text && "text-placeholder")}>{b.text ? b.lines.join("\n") : placeholder}</span>
      )}
      {!root && hasChildren && (
        <button
          type="button"
          aria-label={collapseLabel}
          title={collapseLabel}
          onClick={onToggle}
          className={cn(
            "absolute top-1/2 flex h-4 min-w-4 -translate-y-1/2 items-center justify-center rounded-full border bg-background px-1 text-[10px] leading-none font-medium text-muted-foreground transition-opacity duration-100",
            b.hidden ? "opacity-100" : "opacity-0 group-hover/idea:opacity-100 focus-visible:opacity-100",
          )}
          style={{ borderColor: b.color, [b.side > 0 ? "left" : "right"]: b.w + 2 }}
        >
          {b.hidden ? b.hidden : "−"}
        </button>
      )}
    </div>
  );
}
