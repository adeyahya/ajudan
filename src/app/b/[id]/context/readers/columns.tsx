"use client";

import { DndContext, DragOverlay, MouseSensor, pointerWithin, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { Copy, Ellipsis } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { useLang, useT } from "@/components/i18n";
import { Button, cn, IconButton } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ContextPageKind, ReaderMode } from "@/db/schema";
import { dateLocale } from "@/lib/i18n";
import { setReaderAction } from "../actions";
import { PageIcon } from "../page-icon";

/** A page as one teammate gets it: its size in the prompt (always) or how often it was opened. */
export type LensCard = {
  id: string;
  title: string;
  kind: ContextPageKind;
  icon: string | null;
  mode: ReaderMode;
  /** Always-pages: characters in the prompt, and whether it was cut or left out. */
  chars: number;
  cut: boolean;
  left: boolean;
  /** Runs this week where this teammate read it. */
  runs: number;
};

const COLUMNS: ReaderMode[] = ["always", "when_needed", "never"];

/**
 * The Team view's three columns (Always in the prompt / Read when needed / Never) for
 * one teammate. Drag a card to another column, or use its "…" menu, to change how the
 * teammate gets that page (setReaderAction; the address book can't be Always).
 */
export function LensColumns({ businessId, teammateId, name, cards, used, total }: { businessId: string; teammateId: string; name: string; cards: LensCard[]; used: number; total: number }) {
  const t = useT();
  const lang = useLang();
  const [list, setMode] = useOptimistic(cards, (all, m: { id: string; mode: ReaderMode }) => all.map((c) => (c.id === m.id ? { ...c, mode: m.mode } : c)));
  const [, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
  const allowed = (c: LensCard, mode: ReaderMode) => !(c.kind === "database" && mode === "always");
  const move = (c: LensCard, mode: ReaderMode) => {
    if (c.mode === mode) return;
    if (!allowed(c, mode)) return void toast(t("context.lens.dbNotAlways"));
    start(async () => {
      setMode({ id: c.id, mode });
      await setReaderAction(businessId, c.id, teammateId, mode);
    });
  };
  const n = (v: number) => v.toLocaleString(dateLocale(lang));
  const dragging = list.find((c) => c.id === dragId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragId(String(e.active.id))}
      onDragCancel={() => setDragId(null)}
      onDragEnd={(e) => {
        setDragId(null);
        const c = list.find((x) => x.id === e.active.id);
        const to = e.over?.id as ReaderMode | undefined;
        if (c && to && COLUMNS.includes(to)) move(c, to);
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {COLUMNS.map((mode) => {
          const inCol = list.filter((c) => c.mode === mode);
          return (
            <Column key={mode} mode={mode} blocked={!!dragging && !allowed(dragging, mode)}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[13px] leading-[18px] font-semibold">{t(`context.lens.col.${mode}`)}</h3>
                <span className="text-xs text-tertiary tabular-nums">{inCol.length}</span>
              </div>
              {mode === "always" ? (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" role="img" aria-label={t("context.lens.used", { used: n(used), total: n(total) })}>
                    <div className={cn("h-full rounded-full", used / total > 0.85 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, (used / total) * 100)}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{t("context.lens.used", { used: n(used), total: n(total) })}</p>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t(`context.lens.help.${mode}`, { name })}</p>
              )}
              <div className="mt-3 flex flex-1 flex-col gap-2">
                {inCol.map((c) => (
                  <Card key={c.id} c={c} businessId={businessId} hidden={c.id === dragId} onMove={(m) => move(c, m)} note={note(c)} />
                ))}
                {!inCol.length && <div className="min-h-16 flex-1 rounded-md border border-dashed border-border-strong" aria-hidden />}
              </div>
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <CardBody c={dragging} note={note(dragging)} lifted />}</DragOverlay>
    </DndContext>
  );

  function note(c: LensCard): { text: string; warn?: boolean } {
    if (c.mode === "always") {
      if (c.kind === "database") return { text: t("context.lens.database") };
      if (c.left) return { text: t("context.lens.leftOut"), warn: true };
      if (c.cut) return { text: t("context.lens.cut", { chars: n(c.chars) }), warn: true };
      return { text: t(c.kind === "mindmap" ? "context.lens.wholeMap" : "context.lens.whole", { chars: n(c.chars) }) };
    }
    if (c.mode === "never") return { text: c.kind === "database" ? t("context.lens.database") : "" };
    return { text: c.runs ? t("context.lens.runs", { count: c.runs }) : t(c.kind === "database" ? "context.lens.database" : "context.lens.notYet") };
  }
}

function Column({ mode, blocked, children }: { mode: ReaderMode; blocked: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: mode });
  return (
    <section
      ref={setNodeRef}
      aria-label={mode}
      className={cn("flex min-h-64 flex-col rounded-lg bg-muted p-3 transition-shadow duration-100", isOver && !blocked && "shadow-[inset_0_0_0_2px_var(--ring)]", blocked && "opacity-60")}
    >
      {children}
    </section>
  );
}

function Card({ c, businessId, hidden, onMove, note }: { c: LensCard; businessId: string; hidden: boolean; onMove: (m: ReaderMode) => void; note: { text: string; warn?: boolean } }) {
  const t = useT();
  const { setNodeRef, listeners, attributes } = useDraggable({ id: c.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("group/card relative cursor-grab touch-none active:cursor-grabbing", hidden && "opacity-30")}>
      <CardBody c={c} note={note} href={c.kind === "database" ? `/b/${businessId}/contacts` : `/b/${businessId}/context?page=${c.id}`} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={t("context.lens.moveTo", { title: c.title })} size="icon-xs" className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100" onPointerDown={(e) => e.stopPropagation()}>
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {COLUMNS.filter((m) => m !== c.mode && !(c.kind === "database" && m === "always")).map((m) => (
            <DropdownMenuItem key={m} onSelect={() => onMove(m)}>
              {t(`context.lens.col.${m}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function CardBody({ c, note, href, lifted = false }: { c: LensCard; note: { text: string; warn?: boolean }; href?: string; lifted?: boolean }) {
  return (
    <div className={cn("rounded-md border bg-background px-3 py-2.5 pr-9", note.warn ? "border-warning/50" : "border-border", lifted && "shadow-menu")}>
      <div className="flex items-center gap-2">
        <PageIcon icon={c.icon} kind={c.kind} className="text-tertiary" />
        {href ? (
          <Link href={href} className="min-w-0 truncate text-[13px] leading-[18px] font-medium hover:underline" onPointerDown={(e) => e.stopPropagation()}>
            {c.title}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-[13px] leading-[18px] font-medium">{c.title}</span>
        )}
      </div>
      {note.text && <p className={cn("mt-0.5 pl-6 text-xs", note.warn ? "text-warning" : "text-muted-foreground")}>{note.text}</p>}
    </div>
  );
}

/** The teammate's prompt as it's sent, with Copy. */
export function PromptText({ name, text }: { name: string; text: string }) {
  const t = useT();
  return (
    <section aria-label={t("context.lens.prompt", { name })} className="flex max-h-[420px] min-h-48 flex-col overflow-hidden rounded-lg border border-border 2xl:max-h-[640px]">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border pr-1.5 pl-3.5">
        <h3 className="truncate text-[13px] font-semibold">{t("context.lens.prompt", { name })}</h3>
        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast(t("common.copied")))}>
          <Copy />
          {t("common.copy")}
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto px-3.5 py-3 font-mono text-xs leading-[19px] whitespace-pre-wrap text-muted-foreground">{text || t("context.lens.emptyPrompt")}</pre>
    </section>
  );
}
