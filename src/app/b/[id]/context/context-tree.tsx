"use client";

import { DndContext, DragOverlay, MouseSensor, pointerWithin, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragMoveEvent } from "@dnd-kit/core";
import { ChevronRight, Ellipsis, FolderInput, Link2, PanelLeft, PenLine, Plus, Smile, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { TopBarActions } from "@/components/breadcrumb";
import { useT, useTn } from "@/components/i18n";
import { Button, cn, IconButton, LineTabs } from "@/components/kit";
import { useShortcut } from "@/components/shortcuts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ContextSection } from "@/db/schema";
import { SECTIONS } from "@/lib/context-text";
import { createPageAction, deletePageAction, movePageAction, renamePageAction, setIconAction } from "./actions";
import { IconPicker, PageIcon } from "./page-icon";
import type { TreePage } from "./types";

/**
 * The Konteks page tree (Notion's sidebar, inside the route): Pages / People / Readers
 * tabs, then the pages by section. Rows nest (20px per level) with a chevron, an icon
 * (click to change), the title (double-click or F2 to rename) and, on hover, "+" (a page
 * inside) and "…" (rename, icon, move to, copy link, delete).
 *
 * Drag a row: onto the middle of another row to nest it there, near its top/bottom edge
 * to put it before/after, onto a section header for the top of that section. Moves are
 * optimistic and saved with movePageAction (the server refuses cycles and databases).
 *
 * Keys (when a row has focus): ↑↓ move, → expand / first child, ← collapse / parent,
 * Enter open, F2 rename, Shift+F10 the row's menu. ⌘⇧N anywhere: a new page.
 * ≥1024px it's a 260px pane; below that a left Sheet from the top bar's "Pages" button.
 */

type Drop = { kind: "row"; id: string; zone: "before" | "after" | "nest" | "first" } | { kind: "section"; section: ContextSection };
type Move = { id: string; parentId: string | null; section: ContextSection; index: number };
type Edit = { type: "move"; move: Move } | { type: "rename"; id: string; title: string } | { type: "icon"; id: string; icon: string | null } | { type: "delete"; id: string };

const OPEN_KEY = "ajudan:ctx:open";
const CLOSED_SECTIONS_KEY = "ajudan:ctx:closed";

/** Top-level pages: no parent, or a parent that's gone. */
function isTop(p: TreePage, ids: Set<string>) {
  return !p.parentId || !ids.has(p.parentId);
}

/** The page /context opens on without ?page= (same rule as firstPage in data.ts). */
export function firstPageId(pages: TreePage[]) {
  const ids = new Set(pages.map((p) => p.id));
  for (const s of SECTIONS) {
    const hit = pages.find((p) => p.section === s && isTop(p, ids));
    if (hit) return hit.id;
  }
  return pages[0]?.id ?? null;
}

function siblingsOf(pages: TreePage[], parentId: string | null, section: ContextSection) {
  const ids = new Set(pages.map((p) => p.id));
  return pages.filter((p) => (parentId ? p.parentId === parentId : isTop(p, ids) && p.section === section));
}

function descendants(pages: TreePage[], id: string) {
  const out = new Set<string>();
  const walk = (pid: string) => {
    for (const p of pages) {
      if (p.parentId !== pid || out.has(p.id)) continue;
      out.add(p.id);
      walk(p.id);
    }
  };
  walk(id);
  return out;
}

/** The tree after a move, the way movePage in src/lib/context.ts does it. */
function applyEdit(pages: TreePage[], e: Edit): TreePage[] {
  if (e.type === "rename") return pages.map((p) => (p.id === e.id ? { ...p, title: e.title } : p));
  if (e.type === "icon") return pages.map((p) => (p.id === e.id ? { ...p, icon: e.icon } : p));
  if (e.type === "delete") {
    const gone = pages.find((p) => p.id === e.id);
    return pages.filter((p) => p.id !== e.id).map((p) => (p.parentId === e.id ? { ...p, parentId: gone?.parentId ?? null } : p));
  }
  const { id, parentId, section, index } = e.move;
  const moving = pages.find((p) => p.id === id);
  if (!moving) return pages;
  const under = descendants(pages, id);
  const moved = { ...moving, parentId, section };
  const others = pages.filter((p) => p.id !== id).map((p) => (under.has(p.id) ? { ...p, section } : p));
  const sibs = siblingsOf(others, parentId, section);
  const sibIds = new Set(sibs.map((p) => p.id));
  const next = [...sibs];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, moved);
  return [...others.filter((p) => !sibIds.has(p.id)), ...next];
}

/** Read a JSON string array from localStorage (empty when storage is unavailable). */
function readSet(key: string) {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set<string>(Array.isArray(v) ? v : []);
  } catch {
    return new Set<string>();
  }
}
function writeSet(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {}
}

export function ContextSidebar({ businessId, pages }: { businessId: string; pages: TreePage[] }) {
  const t = useT();
  const [sheet, setSheet] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  const params = useSearchParams();
  const pageParam = params.get("page");
  const [lastPage, setLastPage] = useState(pageParam);
  // Close the phone sheet once the owner picked something.
  if (lastPath !== pathname || lastPage !== pageParam) {
    setLastPath(pathname);
    setLastPage(pageParam);
    setSheet(false);
  }
  return (
    <>
      <aside aria-label={t("context.title")} className="sticky top-(--topbar-h) hidden h-[calc(100dvh-var(--topbar-h))] w-[260px] shrink-0 flex-col border-r border-border bg-background lg:flex">
        <TreeBody businessId={businessId} pages={pages} shortcuts />
      </aside>
      <TopBarActions>
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSheet(true)}>
          <PanelLeft />
          {t("context.tab.pages")}
        </Button>
      </TopBarActions>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="left" showCloseButton={false} className="w-[300px] max-w-[85vw] gap-0 p-0 sm:max-w-[300px]">
          <SheetTitle className="sr-only">{t("context.title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("context.subtitle")}</SheetDescription>
          <TreeBody businessId={businessId} pages={pages} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function TreeBody({ businessId, pages: serverPages, shortcuts = false }: { businessId: string; pages: TreePage[]; shortcuts?: boolean }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/b/${businessId}/context`;
  const [pages, addEdit] = useOptimistic(serverPages, applyEdit);
  const [, start] = useTransition();
  const ids = useMemo(() => new Set(pages.map((p) => p.id)), [pages]);
  const activeId = pathname === base ? (params.get("page") ?? firstPageId(pages)) : null;

  // Open rows and closed sections, remembered on this device.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage after mount
    setOpen(readSet(OPEN_KEY));
    setClosed(readSet(CLOSED_SECTIONS_KEY));
  }, []);
  // The open page's parents unfold so it's visible.
  const [unfolded, setUnfolded] = useState<string | null>(null);
  if (activeId && activeId !== unfolded) {
    setUnfolded(activeId);
    const chain: string[] = [];
    let p = pages.find((x) => x.id === activeId);
    while (p?.parentId && ids.has(p.parentId) && !chain.includes(p.parentId)) {
      chain.push(p.parentId);
      p = pages.find((x) => x.id === p!.parentId);
    }
    if (chain.some((c) => !open.has(c))) setOpen(new Set([...open, ...chain]));
  }
  const toggle = (id: string, to?: boolean) => {
    const next = new Set(open);
    if (to ?? !next.has(id)) next.add(id);
    else next.delete(id);
    setOpen(next);
    writeSet(OPEN_KEY, next);
  };
  const toggleSection = (s: string) => {
    const next = new Set(closed);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setClosed(next);
    writeSet(CLOSED_SECTIONS_KEY, next);
  };

  const childrenOf = (id: string) => pages.filter((p) => p.parentId === id);
  // Rows on screen, in order (for the arrow keys).
  const visible = useMemo(() => {
    const out: { page: TreePage; depth: number }[] = [];
    const walk = (p: TreePage, depth: number) => {
      out.push({ page: p, depth });
      if (open.has(p.id)) for (const c of pages.filter((x) => x.parentId === p.id)) walk(c, depth + 1);
    };
    for (const s of SECTIONS) if (!closed.has(s)) for (const p of pages.filter((x) => x.section === s && isTop(x, ids))) walk(p, 0);
    return out;
  }, [pages, open, closed, ids]);

  // ---- actions
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TreePage | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tree = useRef<HTMLDivElement>(null);

  const newPage = (section: ContextSection, parentId: string | null = null) =>
    start(async () => {
      const id = await createPageAction(businessId, section, t("context.untitled"), parentId);
      if (parentId) toggle(parentId, true);
      router.push(`${base}?page=${id}`);
    });
  const rename = (p: TreePage, title: string) => {
    setRenaming(null);
    const clean = title.trim();
    if (!clean || clean === p.title) return;
    start(async () => {
      addEdit({ type: "rename", id: p.id, title: clean });
      await renamePageAction(businessId, p.id, clean);
    });
  };
  const setIcon = (p: TreePage, icon: string | null) =>
    start(async () => {
      addEdit({ type: "icon", id: p.id, icon: icon || null });
      await setIconAction(businessId, p.id, icon);
    });
  const move = (m: Move) =>
    start(async () => {
      addEdit({ type: "move", move: m });
      const ok = await movePageAction(businessId, m.id, { parentId: m.parentId, section: m.section, index: m.index });
      if (!ok) toast.error(t("context.tree.cantMove"));
    });
  const remove = (p: TreePage) =>
    start(async () => {
      addEdit({ type: "delete", id: p.id });
      const ok = await deletePageAction(businessId, p.id);
      if (ok) toast(t("context.tree.deleted", { title: p.title }));
      if (ok && activeId === p.id) router.push(base);
    });
  const copyLink = (p: TreePage) => {
    void navigator.clipboard?.writeText(`${location.origin}${base}?page=${p.id}`).then(() => toast(t("context.tree.linkCopied")));
  };

  useShortcut(
    "mod+shift+n",
    () => {
      const cur = pages.find((p) => p.id === activeId);
      newPage(cur?.section ?? "business");
    },
    { enabled: shortcuts, allowInInputs: true },
  );

  // ---- keyboard (roving focus over the visible rows)
  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    tree.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (!el || e.target !== el) return;
    const id = el.dataset.row!;
    const i = visible.findIndex((v) => v.page.id === id);
    const cur = visible[i]?.page;
    if (!cur) return;
    const kids = childrenOf(cur.id);
    const keys: Record<string, () => void> = {
      ArrowDown: () => focusRow(visible[i + 1]?.page.id),
      ArrowUp: () => focusRow(visible[i - 1]?.page.id),
      ArrowRight: () => {
        if (kids.length && !open.has(cur.id)) toggle(cur.id, true);
        else if (kids.length) focusRow(kids[0].id);
      },
      ArrowLeft: () => {
        if (kids.length && open.has(cur.id)) toggle(cur.id, false);
        else if (cur.parentId && ids.has(cur.parentId)) focusRow(cur.parentId);
      },
      Enter: () => router.push(`${base}?page=${cur.id}`),
      F2: () => setRenaming(cur.id),
      ContextMenu: () => setMenuFor(cur.id),
    };
    const run = e.key === "F10" && e.shiftKey ? keys.ContextMenu : keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  // ---- drag and drop
  // Mouse: a 5px drag. Touch: a long press, so a finger can still scroll the tree.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const justDragged = useRef(false);
  const dragging = pages.find((p) => p.id === dragId);
  const blocked = useMemo(() => (dragId ? new Set([dragId, ...descendants(pages, dragId)]) : new Set<string>()), [dragId, pages]);

  const onDragMove = (e: DragMoveEvent) => {
    const over = e.over;
    if (!over) return setDrop(null);
    const data = over.data.current as { section?: ContextSection; page?: TreePage } | undefined;
    if (data?.section) return setDrop({ kind: "section", section: data.section });
    const target = data?.page;
    if (!target || blocked.has(target.id)) return setDrop(null);
    const start = e.activatorEvent as MouseEvent | TouchEvent;
    const y = ("touches" in start ? (start.touches[0]?.clientY ?? 0) : start.clientY) + e.delta.y;
    const r = (y - over.rect.top) / over.rect.height;
    let zone: "before" | "after" | "nest" | "first" = r < 0.25 ? "before" : r > 0.75 ? "after" : "nest";
    if (target.kind === "database" && zone === "nest") zone = r < 0.5 ? "before" : "after";
    // Below an open row with children, "after" reads as "first inside".
    if (zone === "after" && open.has(target.id) && childrenOf(target.id).some((c) => c.id !== dragId)) zone = "first";
    setDrop((d) => (d?.kind === "row" && d.id === target.id && d.zone === zone ? d : { kind: "row", id: target.id, zone }));
  };
  const onDragEnd = () => {
    const id = dragId;
    const d = drop;
    setDragId(null);
    setDrop(null);
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    if (!id || !d) return;
    if (d.kind === "section") return move({ id, parentId: null, section: d.section, index: 0 });
    const target = pages.find((p) => p.id === d.id);
    if (!target) return;
    if (d.zone === "nest" || d.zone === "first") {
      const count = childrenOf(target.id).filter((c) => c.id !== id).length;
      toggle(target.id, true);
      return move({ id, parentId: target.id, section: target.section, index: d.zone === "first" ? 0 : count });
    }
    const parentId = target.parentId && ids.has(target.parentId) ? target.parentId : null;
    const sibs = siblingsOf(pages.filter((p) => p.id !== id), parentId, target.section);
    const at = sibs.findIndex((p) => p.id === target.id) + (d.zone === "after" ? 1 : 0);
    move({ id, parentId, section: target.section, index: at });
  };

  const tabs = [
    { href: base, label: t("context.tab.pages"), active: pathname === base },
    { href: `${base}/people`, label: t("context.tab.people"), active: pathname.startsWith(`${base}/people`) },
    { href: `${base}/readers`, label: t("context.tab.readers"), active: pathname.startsWith(`${base}/readers`) },
  ];

  const row = (p: TreePage, depth: number) => (
    <TreeRow
      key={p.id}
      page={p}
      depth={depth}
      href={`${base}?page=${p.id}`}
      active={p.id === activeId}
      focusable={(focusId ?? activeId ?? visible[0]?.page.id) === p.id}
      hasChildren={pages.some((c) => c.parentId === p.id)}
      expanded={open.has(p.id)}
      drop={drop?.kind === "row" && drop.id === p.id ? drop.zone : null}
      dimmed={blocked.has(p.id)}
      renaming={renaming === p.id}
      menuOpen={menuFor === p.id}
      iconOpen={iconFor === p.id}
      onToggle={() => toggle(p.id)}
      onFocus={() => setFocusId(p.id)}
      onRename={(title) => rename(p, title)}
      onStartRename={() => setRenaming(p.id)}
      onCancelRename={() => setRenaming(null)}
      onMenu={(o) => setMenuFor(o ? p.id : null)}
      onIconOpen={(o) => setIconFor(o ? p.id : null)}
      onIcon={(icon) => setIcon(p, icon)}
      onAddChild={() => newPage(p.section, p.id)}
      onMoveTo={(section) => move({ id: p.id, parentId: null, section, index: siblingsOf(pages, null, section).filter((x) => x.id !== p.id).length })}
      onCopyLink={() => copyLink(p)}
      onDelete={() => setDeleting(p)}
      justDragged={justDragged}
    >
      {open.has(p.id) && pages.filter((c) => c.parentId === p.id).map((c) => row(c, depth + 1))}
    </TreeRow>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LineTabs items={tabs} label={t("context.title")} className="shrink-0 px-3" />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => setDragId(String(e.active.id))}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => (setDragId(null), setDrop(null))}
      >
        <div ref={tree} role="tree" aria-label={t("context.tab.pages")} onKeyDown={onKey} className="min-h-0 flex-1 overflow-y-auto px-2 pt-3 pb-6">
          {SECTIONS.map((s) => {
            const top = pages.filter((x) => x.section === s && isTop(x, ids));
            return (
              <div key={s} role="group" className="mb-3">
                <SectionHeader
                  section={s}
                  label={t(`context.section.${s}`)}
                  closed={closed.has(s)}
                  dropping={drop?.kind === "section" && drop.section === s}
                  onToggle={() => toggleSection(s)}
                  onAdd={() => newPage(s)}
                  addLabel={t("context.newPageIn", { section: t(`context.section.${s}`) })}
                />
                {!closed.has(s) && (top.length ? top.map((p) => row(p, 0)) : <p className="py-1 pr-2 pl-[30px] text-[13px] leading-[18px] text-placeholder">{t("context.tree.empty")}</p>)}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => newPage(pages.find((p) => p.id === activeId)?.section ?? "business")}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] leading-[18px] font-medium text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-4 text-tertiary" strokeWidth={1.75} aria-hidden />
            {t("context.newPage")}
          </button>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="flex h-7 max-w-[240px] items-center gap-2 rounded-md bg-background px-2 text-[13px] font-medium text-foreground opacity-90 shadow-menu">
              <PageIcon icon={dragging.icon} kind={dragging.kind} className="text-tertiary" />
              <span className="truncate">{dragging.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("context.deleteConfirm", { title: deleting?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("context.tree.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => deleting && remove(deleting)}>
              {t("context.deletePage")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SectionHeader({
  section,
  label,
  closed,
  dropping,
  onToggle,
  onAdd,
  addLabel,
}: {
  section: ContextSection;
  label: string;
  closed: boolean;
  dropping: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel: string;
}) {
  const { setNodeRef } = useDroppable({ id: `section:${section}`, data: { section } });
  return (
    <div ref={setNodeRef} className={cn("group/sec flex h-7 items-center rounded-md pr-1 transition-colors duration-100", dropping ? "bg-primary-soft ring-1 ring-primary/40 ring-inset" : "hover:bg-hover")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!closed}
        className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-xs leading-4 font-medium text-tertiary"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover/sec:opacity-100", !closed && "rotate-90", closed && "opacity-100")}
        />
      </button>
      <IconButton label={addLabel} size="icon-xs" className="opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100" onClick={onAdd}>
        <Plus />
      </IconButton>
    </div>
  );
}

function TreeRow({
  page,
  depth,
  href,
  active,
  focusable,
  hasChildren,
  expanded,
  drop,
  dimmed,
  renaming,
  menuOpen,
  iconOpen,
  onToggle,
  onFocus,
  onRename,
  onStartRename,
  onCancelRename,
  onMenu,
  onIconOpen,
  onIcon,
  onAddChild,
  onMoveTo,
  onCopyLink,
  onDelete,
  justDragged,
  children,
}: {
  page: TreePage;
  depth: number;
  href: string;
  active: boolean;
  focusable: boolean;
  hasChildren: boolean;
  expanded: boolean;
  drop: "before" | "after" | "nest" | "first" | null;
  dimmed: boolean;
  renaming: boolean;
  menuOpen: boolean;
  iconOpen: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onRename: (title: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onMenu: (open: boolean) => void;
  onIconOpen: (open: boolean) => void;
  onIcon: (icon: string | null) => void;
  onAddChild: () => void;
  onMoveTo: (section: ContextSection) => void;
  onCopyLink: () => void;
  onDelete: () => void;
  justDragged: React.RefObject<boolean>;
  children?: React.ReactNode;
}) {
  const t = useT();
  const tn = useTn();
  const drag = useDraggable({ id: page.id, data: { page } });
  const dropRef = useDroppable({ id: page.id, data: { page } });
  const indent = 4 + depth * 20;
  const canNest = page.kind === "page";
  return (
    <div role="none">
      <div
        ref={(el) => {
          drag.setNodeRef(el);
          dropRef.setNodeRef(el);
        }}
        {...drag.listeners}
        data-row={page.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={active}
        aria-expanded={hasChildren ? expanded : undefined}
        tabIndex={focusable ? 0 : -1}
        onFocus={(e) => e.target === e.currentTarget && onFocus()}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          onStartRename();
        }}
        className={cn(
          "group/row relative flex h-7 cursor-pointer items-center gap-0.5 rounded-md pr-1 text-[13px] leading-[18px] font-medium outline-none select-none",
          "transition-colors duration-100 focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]",
          active ? "bg-accent text-foreground" : "text-sidebar-foreground hover:bg-hover",
          drop === "nest" && "bg-primary-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent)]",
          dimmed && "opacity-40",
        )}
        style={{ paddingLeft: indent }}
      >
        {(drop === "before" || drop === "after" || drop === "first") && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute right-1 h-0.5 rounded-full bg-primary", drop === "before" ? "-top-px" : "-bottom-px")}
            style={{ left: drop === "first" ? indent + 20 : indent }}
          />
        )}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t(expanded ? "context.tree.collapse" : "context.tree.expand")}
            onClick={onToggle}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-tertiary hover:bg-hover-strong hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-90")} strokeWidth={2} />
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <IconPicker open={iconOpen} onOpenChange={onIconOpen} onPick={onIcon}>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("context.tree.changeIcon")}
            className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-hover-strong", active ? "text-foreground" : "text-tertiary")}
          >
            <PageIcon icon={page.icon} kind={page.kind} />
          </button>
        </IconPicker>
        {renaming ? (
          <input
            autoFocus
            defaultValue={page.title}
            aria-label={t("context.tree.rename")}
            onFocus={(e) => e.currentTarget.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onRename(e.currentTarget.value);
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={(e) => onRename(e.currentTarget.value)}
            className="ml-1 h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-[13px] text-foreground ring-2 ring-ring/30 outline-none"
          />
        ) : (
          <Link
            href={href}
            tabIndex={-1}
            draggable={false}
            onClick={(e) => justDragged.current && e.preventDefault()}
            className="ml-1 min-w-0 flex-1 truncate"
            title={page.title}
          >
            {page.title || t("context.untitled")}
          </Link>
        )}
        {page.pending > 0 && (
          <span
            title={tn("context.pendingBadge", page.pending)}
            className="ml-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-[14px] font-semibold text-primary-foreground tabular-nums group-hover/row:hidden"
          >
            {page.pending}
          </span>
        )}
        <div className={cn("ml-auto hidden shrink-0 items-center group-focus-within/row:flex group-hover/row:flex", menuOpen && "flex")}>
          <DropdownMenu open={menuOpen} onOpenChange={onMenu}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("context.tree.more")}
                className="flex size-5 items-center justify-center rounded-sm text-tertiary hover:bg-hover-strong hover:text-foreground"
              >
                <Ellipsis className="size-4" strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onSelect={onStartRename}>
                <PenLine />
                {t("context.tree.rename")}
                <span className="ml-auto text-xs text-tertiary">F2</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTimeout(() => onIconOpen(true), 0)}>
                <Smile />
                {t("context.tree.changeIcon")}
              </DropdownMenuItem>
              {!page.parentId && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput />
                    {t("context.tree.moveTo")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {SECTIONS.filter((s) => s !== page.section).map((s) => (
                      <DropdownMenuItem key={s} onSelect={() => onMoveTo(s)}>
                        {t(`context.section.${s}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {page.parentId && (
                <DropdownMenuItem onSelect={() => onMoveTo(page.section)}>
                  <FolderInput />
                  {t("context.tree.moveOut")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onCopyLink}>
                <Link2 />
                {t("context.tree.copyLink")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={!!page.key} onSelect={onDelete}>
                <Trash2 />
                {page.key ? t("context.tree.kept") : t("context.deletePage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canNest && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t("context.tree.addChild")}
              title={t("context.tree.addChild")}
              onClick={onAddChild}
              className="flex size-5 items-center justify-center rounded-sm text-tertiary hover:bg-hover-strong hover:text-foreground"
            >
              <Plus className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      {children && <div role="group">{children}</div>}
    </div>
  );
}
