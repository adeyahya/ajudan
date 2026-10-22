"use client";

import { BookOpen, FileText, Keyboard, MessageSquarePlus, PanelLeft, Repeat, Search, Store, Table2, User, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { SearchGroup, SearchResult } from "@/app/api/b/[id]/search/route";
import { useT } from "@/components/i18n";
import { Avatar } from "@/components/kit";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useModKey } from "@/components/shortcuts";

/**
 * The ⌘K palette (UI-PLAN §2.5). Mounted once by the business shell inside
 * <CommandPaletteProvider>. Groups: This page (registered by the page), Go to, Teammates,
 * Pages, People, Work (from GET /api/b/[id]/search, debounced 120ms), Actions.
 *
 * Pages add their own commands while mounted:
 *   client:  useRegisterCommands([{ id: "new-person", label: "New person", icon: UserPlus, perform: () => … }])
 *   server:  <RegisterCommands commands={[{ id: "export", label: "Export contacts", href: "/b/…/export" }]} />
 * Open it from code with useCommandPalette().setOpen(true).
 */

export type PaletteCommand = {
  id: string;
  label: string;
  /** Extra words to match ("add", "create"). */
  keywords?: string[];
  icon?: LucideIcon;
  /** Navigate here… */
  href?: string;
  /** …or run this (client callers only). */
  perform?: () => void;
  /** Shown right-aligned, e.g. "⌘⇧N". */
  shortcut?: string;
};

type Ctx = {
  open: boolean;
  setOpen: (open: boolean) => void;
  pageCommands: PaletteCommand[];
  setPageCommands: (fn: (prev: Record<string, PaletteCommand[]>) => Record<string, PaletteCommand[]>) => void;
};

const PaletteContext = createContext<Ctx | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [byOwner, setByOwner] = useState<Record<string, PaletteCommand[]>>({});
  const pageCommands = useMemo(() => Object.values(byOwner).flat(), [byOwner]);
  return (
    <PaletteContext.Provider value={{ open, setOpen, pageCommands, setPageCommands: setByOwner }}>{children}</PaletteContext.Provider>
  );
}

/** Open/close the palette from anywhere under the business shell. */
export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  return {
    open: ctx?.open ?? false,
    setOpen: ctx?.setOpen ?? (() => {}),
    toggle: () => ctx?.setOpen(!ctx.open),
  };
}

let ownerSeq = 0;

/** Add commands to the palette's "This page" group while the calling component is mounted. */
export function useRegisterCommands(commands: PaletteCommand[]) {
  const set = useContext(PaletteContext)?.setPageCommands;
  const [owner] = useState(() => `o${++ownerSeq}`);
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const key = commands.map((c) => `${c.id}:${c.label}:${c.href ?? ""}`).join("|");
  useEffect(() => {
    if (!set) return;
    // `perform` goes through the ref so callers needn't memoize it.
    const cmds = latest.current.map((c) => (c.perform ? { ...c, perform: () => latest.current.find((x) => x.id === c.id)?.perform?.() } : c));
    set((prev) => ({ ...prev, [owner]: cmds }));
    return () =>
      set((prev) => {
        const next = { ...prev };
        delete next[owner];
        return next;
      });
  }, [key, owner, set]);
}

/** Server-page form of useRegisterCommands (link commands only). */
export function RegisterCommands({ commands }: { commands: PaletteCommand[] }) {
  useRegisterCommands(commands);
  return null;
}

export type PaletteTeammate = { id: string; name: string; title: string; color: string };
export type PaletteNavItem = { label: string; href: string; icon: LucideIcon };

const GROUP_ICON: Record<Exclude<SearchGroup, "teammates">, LucideIcon> = { pages: FileText, people: User, work: Table2 };
const GROUP_LABEL = { pages: "palette.pages", people: "palette.people", work: "palette.work" } as const;

const matches = (q: string, ...hay: (string | undefined)[]) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return hay.some((h) => h?.toLowerCase().includes(needle));
};

export function CommandPalette({
  businessId,
  nav,
  teammates,
  onToggleSidebar,
  onShowShortcuts,
  onSwitchBusiness,
  onNewPage,
}: {
  businessId: string;
  /** "Go to" items (the sidebar's destinations), hrefs absolute. */
  nav: PaletteNavItem[];
  teammates: PaletteTeammate[];
  onToggleSidebar: () => void;
  onShowShortcuts: () => void;
  onSwitchBusiness: () => void;
  onNewPage: () => void;
}) {
  const t = useT();
  const mod = useModKey();
  const router = useRouter();
  const ctx = useContext(PaletteContext);
  const open = ctx?.open ?? false;
  const setOpen = useCallback((o: boolean) => ctx?.setOpen(o), [ctx]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, SearchResult[]>());
  const [, startTransition] = useTransition();
  const base = `/b/${businessId}`;
  // Each opening starts empty with fresh results (pages and work change while you're here).
  const [session, setSession] = useState({ open, n: 0 });
  if (session.open !== open) {
    setSession({ open, n: open ? session.n + 1 : session.n });
    if (!open) setQ("");
  }

  // Debounced server search (cached per query while the page lives).
  useEffect(() => {
    if (!open) return;
    const key = q.trim();
    const cacheKey = `${session.n}:${key}`;
    const hit = cache.current.get(cacheKey);
    if (hit) {
      setResults(hit);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/b/${businessId}/search?q=${encodeURIComponent(key)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results: SearchResult[] }) => {
          cache.current.set(cacheKey, d.results);
          setResults(d.results);
          setLoading(false);
        })
        .catch(() => {});
    }, key ? 120 : 0);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open, businessId, session.n]);


  const run = (fn: () => void) => {
    setOpen(false);
    // Let the dialog start closing before navigating.
    requestAnimationFrame(() => startTransition(fn));
  };
  const go = (href: string) => run(() => router.push(href));
  const runCommand = (c: PaletteCommand) => run(() => (c.perform ? c.perform() : c.href && router.push(c.href)));

  const query = q.trim();
  const pageCommands = (ctx?.pageCommands ?? []).filter((c) => matches(query, c.label, ...(c.keywords ?? [])));
  const goTo = nav.filter((n) => matches(query, n.label));
  const people = teammates.filter((m) => matches(query, m.name, m.title));
  const actions: PaletteCommand[] = [
    { id: "new-page", label: t("action.newPage"), icon: BookOpen, perform: onNewPage, keywords: ["konteks", "context", "page"] },
    { id: "give-task", label: t("action.giveTask"), icon: MessageSquarePlus, href: `${base}?compose=1`, keywords: ["task", "tugas", "chat"] },
    { id: "office", label: t("action.openOffice"), icon: Store, href: `${base}/office` },
    { id: "toggle-sidebar", label: t("action.toggleSidebar"), icon: PanelLeft, perform: onToggleSidebar, shortcut: `${mod}\\` },
    { id: "switch-business", label: t("action.switchBusiness"), icon: Repeat, perform: onSwitchBusiness },
    { id: "shortcuts", label: t("action.shortcuts"), icon: Keyboard, perform: onShowShortcuts, shortcut: `${mod}/` },
  ].filter((a) => matches(query, a.label, ...(a.keywords ?? [])));
  const grouped = (g: Exclude<SearchGroup, "teammates">) => results.filter((r) => r.group === g);
  const nothing =
    !loading && !pageCommands.length && !goTo.length && !people.length && !actions.length && !results.some((r) => r.group !== "teammates");

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")} description={t("palette.description")}>
      <Command shouldFilter={false} loop>
        <CommandInput value={q} onValueChange={setQ} placeholder={t("palette.placeholder")} />
        <CommandList>
          {nothing && <CommandEmpty>{t("palette.empty")}</CommandEmpty>}

          {pageCommands.length > 0 && (
            <CommandGroup heading={t("palette.thisPage")}>
              {pageCommands.map((c) => (
                <PaletteItem key={c.id} value={`page:${c.id}`} icon={c.icon} label={c.label} shortcut={c.shortcut} onSelect={() => runCommand(c)} />
              ))}
            </CommandGroup>
          )}

          {goTo.length > 0 && (
            <CommandGroup heading={t("palette.goTo")}>
              {goTo.map((n) => (
                <PaletteItem key={n.href} value={`nav:${n.href}`} icon={n.icon} label={n.label} onSelect={() => go(n.href)} />
              ))}
            </CommandGroup>
          )}

          {people.length > 0 && (
            <CommandGroup heading={t("palette.teammates")}>
              {people.map((m) => (
                <CommandItem key={m.id} value={`tm:${m.id}`} onSelect={() => go(`${base}/teammates/${m.id}`)}>
                  <Avatar name={m.name} color={m.color} seed={m.id} size={20} />
                  <span className="truncate">{m.name}</span>
                  <span className="truncate text-xs text-tertiary">{m.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {(["pages", "people", "work"] as const).map((g) => {
            const items = grouped(g);
            if (!items.length) return null;
            return (
              <CommandGroup key={g} heading={t(GROUP_LABEL[g])}>
                {items.map((r) => (
                  <PaletteItem
                    key={`${g}:${r.id}`}
                    value={`${g}:${r.id}`}
                    icon={GROUP_ICON[g]}
                    label={r.title || t("action.untitled")}
                    hint={r.subtitle}
                    onSelect={() => go(r.href)}
                  />
                ))}
              </CommandGroup>
            );
          })}

          {loading && !results.length && (
            <div className="flex h-9 items-center gap-2.5 px-3 text-[13px] text-tertiary">
              <Search className="size-4 animate-pulse" aria-hidden />
              {t("palette.searching")}
            </div>
          )}

          {actions.length > 0 && (
            <CommandGroup heading={t("palette.actions")}>
              {actions.map((a) => (
                <PaletteItem key={a.id} value={`act:${a.id}`} icon={a.icon} label={a.label} shortcut={a.shortcut} onSelect={() => runCommand(a)} />
              ))}
            </CommandGroup>
          )}
        </CommandList>
        <div className="hidden h-9 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-tertiary sm:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("palette.hintNavigate")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {t("palette.hintOpen")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            {t("palette.hintClose")}
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}

function PaletteItem({
  value,
  icon: Icon,
  label,
  hint,
  shortcut,
  onSelect,
}: {
  value: string;
  icon?: LucideIcon;
  label: string;
  hint?: string;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={value} onSelect={onSelect}>
      {Icon ? <Icon strokeWidth={1.75} aria-hidden /> : <span className="size-4" />}
      <span className="min-w-0 truncate">{label}</span>
      {hint && <span className="min-w-0 shrink truncate text-xs text-tertiary">{hint}</span>}
      {shortcut && <Kbd className="ml-auto">{shortcut}</Kbd>}
    </CommandItem>
  );
}
