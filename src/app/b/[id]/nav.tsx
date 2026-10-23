"use client";

import {
  Activity,
  AlertCircle,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Clapperboard,
  Folder,
  FolderCheck,
  Headset,
  Home,
  Inbox,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PenLine,
  Plus,
  Search,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { openFolder } from "@/app/actions";
import { BreadcrumbProvider } from "@/components/breadcrumb";
import { CommandPalette, CommandPaletteProvider, useCommandPalette } from "@/components/command-palette";
import { useT } from "@/components/i18n";
import { Badge, CountPill, IconButton, Kbd } from "@/components/kit";
import { ShortcutsDialog, useGlobalShortcuts, useModKey } from "@/components/shortcuts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { appBridge } from "@/lib/app-bridge";
import type { MessageKey } from "@/lib/i18n";
import { statusTone } from "@/lib/status-tones";
import { cn } from "@/lib/utils";
import { createPageAction } from "./context/actions";
import { TopBar } from "./top-bar";

/**
 * The business shell (UI-PLAN §2.5): one Notion-style left sidebar (workspace switcher,
 * search, pages, collapsible sections, worker + spend footer), a 44px top bar with
 * breadcrumbs, the ⌘K palette, toasts and global shortcuts. Phone: a bottom bar
 * (Chat, Inbox, Work, Menu) and the same sidebar in a left sheet.
 *
 * Sidebar width (200–360, default 240) and collapsed state persist in localStorage
 * (`ajudan:sidebar:w`, `ajudan:sidebar:collapsed`, sections `ajudan:sidebar:sec:<name>`)
 * and are applied before first paint by the inline script in src/app/layout.tsx.
 * ⌘\ toggles it; `useSidebar()` exposes the same from any client component below.
 */

type Item = { href: string; label: MessageKey; icon: LucideIcon; title?: MessageKey };

/** Where the owner spends the day. Chat is home: the manager, with the office above it. */
const PRIMARY: Item[] = [
  { href: "", label: "nav.chat", icon: MessageSquare },
  { href: "/office", label: "nav.office", icon: Building2 },
  { href: "/approvals", label: "nav.inbox", icon: Inbox },
  { href: "/deliverables", label: "nav.work", icon: FolderCheck },
  { href: "/context", label: "nav.context", icon: BookOpen },
  { href: "/team", label: "nav.team", icon: Users },
];
const WORKSPACE: Item[] = [
  { href: "/desk", label: "nav.desk", icon: Headset },
  { href: "/studio", label: "nav.studio", icon: Clapperboard },
  { href: "/files", label: "nav.files", icon: Folder },
];
const SETTINGS: Item[] = [
  { href: "/profile", label: "nav.business", icon: Store },
  { href: "/health", label: "nav.health", icon: Activity, title: "nav.healthTitle" },
  { href: "/onboarding", label: "nav.interview", icon: PenLine },
];

/** All destinations with their labels (breadcrumbs, palette). */
export const NAV_ITEMS: Item[] = [...PRIMARY, ...WORKSPACE, ...SETTINGS];

export function isActive(pathname: string, base: string, href: string) {
  if (href === "") return pathname === base || pathname === `${base}/manager` || pathname.startsWith(`${base}/teammates/`);
  return pathname === base + href || pathname.startsWith(`${base}${href}/`);
}

/** Chat pages fill the viewport (the conversation scrolls inside). */
export function isChatRoute(pathname: string, base: string) {
  return isActive(pathname, base, "");
}

/* ------------------------------------------------------------------ sidebar state */

const COLLAPSED_KEY = "ajudan:sidebar:collapsed";
const WIDTH_KEY = "ajudan:sidebar:w";
const W_MIN = 200;
const W_MAX = 360;
const W_DEFAULT = 240;

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const emit = () => listeners.forEach((l) => l());
const html = () => document.documentElement;
const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

function setCollapsedDom(collapsed: boolean) {
  if (collapsed) html().setAttribute("data-sidebar", "collapsed");
  else html().removeAttribute("data-sidebar");
  store(COLLAPSED_KEY, collapsed ? "1" : null);
  emit();
}

/** Section open state lives on <html data-sec-<name>="closed"> (restored before paint). */
function setSectionDom(name: string, open: boolean) {
  if (open) html().removeAttribute(`data-sec-${name}`);
  else html().setAttribute(`data-sec-${name}`, "closed");
  store(`ajudan:sidebar:sec:${name}`, open ? null : "0");
  emit();
}

function useDomFlag(read: () => boolean) {
  return useSyncExternalStore(subscribe, read, () => false);
}

type SidebarCtx = { collapsed: boolean; toggle: () => void; setCollapsed: (v: boolean) => void; openMobile: () => void };
const SidebarContext = createContext<SidebarCtx | null>(null);

/** The sidebar's state: collapsed on desktop, and opening it as a sheet on a phone. */
export function useSidebar(): SidebarCtx {
  return useContext(SidebarContext) ?? { collapsed: false, toggle: () => {}, setCollapsed: () => {}, openMobile: () => {} };
}

/* ------------------------------------------------------------------ shell */

/** `running`: another business working in the background (desktop app). */
export type ShellFolder = { dir: string; name: string; path: string; status: string | null; isOpen: boolean; running: boolean };
export type ShellTeammate = { id: string; name: string; title: string; color: string; state: string };
export type ShellSpend = { today: number; week: number; cap: number; over: boolean };

export type AppShellProps = {
  businessId: string;
  businessName: string;
  hideInterview: boolean;
  pendingApprovals: number;
  inApp: boolean;
  workerRunning: boolean;
  spend: ShellSpend;
  folders: ShellFolder[];
  teammates: ShellTeammate[];
  children: ReactNode;
};

export function AppShell(props: AppShellProps) {
  return (
    <BreadcrumbProvider>
      <CommandPaletteProvider>
        <ShellInner {...props} />
      </CommandPaletteProvider>
    </BreadcrumbProvider>
  );
}

function ShellInner({ businessId, businessName, teammates, workerRunning, children, ...rest }: AppShellProps) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const base = `/b/${businessId}`;
  const palette = useCommandPalette();
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = useDomFlag(() => html().getAttribute("data-sidebar") === "collapsed");
  const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;
  // Read the DOM, not state: a click before hydration finishes must still flip the real thing.
  const toggle = () => (isDesktop() ? setCollapsedDom(html().getAttribute("data-sidebar") !== "collapsed") : setMobileOpen((o) => !o));
  const sidebar: SidebarCtx = { collapsed, toggle, setCollapsed: setCollapsedDom, openMobile: () => setMobileOpen(true) };

  useGlobalShortcuts({
    onSearch: palette.toggle,
    onToggleSidebar: toggle,
    onHelp: () => setHelpOpen((o) => !o),
    go: (href) => router.push(base + href),
  });

  // Close the phone sheet after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  // Tell the owner once per session when nothing will run.
  // Deferred: the Toaster subscribes in its own effect, and a toast sent before that is lost.
  useEffect(() => {
    if (workerRunning) return;
    const timer = setTimeout(() => {
      try {
        if (sessionStorage.getItem("ajudan:worker-toast")) return;
        sessionStorage.setItem("ajudan:worker-toast", "1");
      } catch {}
      toast.error(t("nav.workerDown"), { description: t("workerBanner.toast"), id: "worker-down" });
    }, 600);
    return () => clearTimeout(timer);
  }, [workerRunning, t]);

  const newPage = () => {
    void createPageAction(businessId, "business", t("action.untitled")).then((id) => router.push(`${base}/context?page=${id}`));
  };
  const showFolders = () => {
    if (rest.inApp) void appBridge()?.showHome();
    else router.push("/");
  };

  const chat = isChatRoute(pathname, base);
  const sidebarProps = { businessId, businessName, workerRunning, onNewPage: newPage, ...rest };

  return (
    <SidebarContext.Provider value={sidebar}>
      <div data-business-shell className="flex min-h-dvh w-full">
        <aside
          aria-label={t("nav.menu")}
          className="app-sidebar app-sidebar-panel sticky top-0 z-30 hidden h-dvh shrink-0 border-r border-border bg-sidebar transition-[width,border-color] duration-200 ease-(--ease) md:block"
        >
          <div className="h-full overflow-hidden">
            <div className="h-full w-(--sidebar-w-open)">
              <SidebarContent {...sidebarProps} onCollapse={() => setCollapsedDom(true)} />
            </div>
          </div>
          <ResizeHandle />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar businessId={businessId} businessName={businessName} teammates={teammates} onOpenSidebar={toggle} />
          <main className="flex min-w-0 flex-1 flex-col">
            <div
              data-chat={chat || undefined}
              className="app-frame min-w-0 flex-1"
            >
              {children}
            </div>
          </main>
        </div>

        <BottomBar base={base} pending={rest.pendingApprovals} onMenu={() => setMobileOpen(true)} />

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" showCloseButton={false} className="w-[280px] gap-0 bg-sidebar p-0 sm:max-w-[280px]">
            <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
            <SidebarContent {...sidebarProps} mobile />
          </SheetContent>
        </Sheet>

        <CommandPalette
          businessId={businessId}
          teammates={teammates}
          nav={NAV_ITEMS.filter((i) => !(rest.hideInterview && i.href === "/onboarding")).map((i) => ({
            label: t(i.label),
            href: base + i.href,
            icon: i.icon,
          }))}
          onToggleSidebar={toggle}
          onShowShortcuts={() => setHelpOpen(true)}
          onSwitchBusiness={showFolders}
          onNewPage={newPage}
        />
        <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
        <Toaster />
      </div>
    </SidebarContext.Provider>
  );
}

/* ------------------------------------------------------------------ sidebar */

type SidebarProps = Omit<AppShellProps, "children" | "teammates"> & {
  onNewPage: () => void;
  onCollapse?: () => void;
  mobile?: boolean;
};

function SidebarContent({
  businessId,
  businessName,
  hideInterview,
  pendingApprovals,
  inApp,
  workerRunning,
  spend,
  folders,
  onNewPage,
  onCollapse,
  mobile = false,
}: SidebarProps) {
  const t = useT();
  const mod = useModKey();
  const pathname = usePathname();
  const palette = useCommandPalette();
  const base = `/b/${businessId}`;
  const settings = SETTINGS.filter((i) => !(hideInterview && i.href === "/onboarding" && !isActive(pathname, base, i.href)));
  const row = (item: Item) => (
    <NavRow
      key={item.href}
      href={base + item.href}
      icon={item.icon}
      label={t(item.label)}
      title={item.title ? t(item.title) : undefined}
      active={isActive(pathname, base, item.href)}
      trailing={item.href === "/approvals" ? <CountPill count={pendingApprovals} /> : undefined}
      action={
        item.href === "/context" ? (
          <IconButton label={t("nav.newPage")} size="icon-xs" side="right" onClick={onNewPage} className="text-tertiary">
            <Plus />
          </IconButton>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="group/switcher flex items-center gap-0.5 px-2 pt-2 pb-1">
        <WorkspaceSwitcher businessName={businessName} folders={folders} inApp={inApp} />
        {!mobile && onCollapse && (
          <IconButton
            label={t("nav.collapseSidebar")}
            shortcut={`${mod}\\`}
            onClick={onCollapse}
            className="opacity-0 transition-opacity duration-100 group-hover/switcher:opacity-100 focus-visible:opacity-100"
          >
            <PanelLeftClose />
          </IconButton>
        )}
      </div>

      <nav aria-label={t("nav.menu")} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          className="group flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 text-[13px] leading-[18px] font-medium text-sidebar-foreground transition-colors duration-100 hover:bg-hover"
        >
          <Search className="size-4 shrink-0 text-tertiary" strokeWidth={1.75} aria-hidden />
          <span className="flex-1 truncate text-left">{t("nav.search")}</span>
          <Kbd className="hidden bg-transparent lg:inline-flex">{mod}K</Kbd>
        </button>

        <div className="mt-2 space-y-px">{PRIMARY.map(row)}</div>

        <NavSection name="workspace" label={t("nav.workspace")}>
          {WORKSPACE.map(row)}
        </NavSection>
        <NavSection name="settings" label={t("nav.settings")}>
          {settings.map(row)}
        </NavSection>

        <div className="mt-auto space-y-px pt-4">
          {!workerRunning && (
            <Link
              href={`${base}/health`}
              className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] leading-[18px] font-medium text-destructive transition-colors duration-100 hover:bg-hover"
            >
              <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{t("nav.workerDown")}</span>
            </Link>
          )}
          <SpendLine base={base} spend={spend} />
        </div>
      </nav>
    </div>
  );
}

function NavRow({
  href,
  icon: Icon,
  label,
  title,
  active,
  trailing,
  action,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  title?: string;
  active: boolean;
  trailing?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="group/row relative">
      <Link
        href={href}
        title={title}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] leading-[18px] font-medium transition-colors duration-100",
          active ? "bg-accent text-foreground" : "text-sidebar-foreground hover:bg-hover",
          action && "group-hover/row:pr-8 group-focus-within/row:pr-8",
        )}
      >
        <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-tertiary")} strokeWidth={active ? 2 : 1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </Link>
      {action && (
        <div className="absolute top-0.5 right-1 opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
          {action}
        </div>
      )}
    </div>
  );
}

function NavSection({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  const open = !useDomFlag(() => html().getAttribute(`data-sec-${name}`) === "closed");
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setSectionDom(name, !open)}
        className="group/sec flex h-6 w-full items-center gap-1 rounded-md px-2 text-xs leading-4 font-medium text-tertiary transition-colors duration-100 hover:bg-hover hover:text-muted-foreground"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          data-sec-chevron={name}
          className="size-3.5 opacity-0 transition-[opacity,transform] duration-150 group-hover/sec:opacity-100 group-focus-visible/sec:opacity-100"
          aria-hidden
        />
      </button>
      <div data-sec-body={name} className="mt-px space-y-px">
        {children}
      </div>
    </div>
  );
}

function SpendLine({ base, spend }: { base: string; spend: ShellSpend }) {
  const t = useT();
  const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
  const text = spend.cap > 0
    ? t("nav.spend", { today: usd(spend.today), cap: usd(spend.cap), week: usd(spend.week) })
    : t("nav.spendNoCap", { today: usd(spend.today), week: usd(spend.week) });
  return (
    <Link
      href={`${base}/profile`}
      title={spend.over ? t("nav.overBudget") : undefined}
      className={cn(
        "flex min-h-7 items-center rounded-md px-2 py-1 text-xs leading-4 tabular-nums transition-colors duration-100 hover:bg-hover",
        spend.over ? "text-destructive" : "text-tertiary",
      )}
    >
      <span className="line-clamp-2">{text}</span>
    </Link>
  );
}

function ResizeHandle() {
  const t = useT();
  const start = useRef<{ x: number; w: number } | null>(null);
  const setW = (w: number) => html().style.setProperty("--sidebar-w-open", `${w}px`);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("nav.resizeSidebar")}
      title={t("nav.resizeSidebar")}
      onPointerDown={(e) => {
        const w = Number.parseFloat(getComputedStyle(html()).getPropertyValue("--sidebar-w-open")) || W_DEFAULT;
        start.current = { x: e.clientX, w };
        html().setAttribute("data-sidebar-resizing", "");
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        setW(Math.round(Math.min(W_MAX, Math.max(W_MIN, start.current.w + e.clientX - start.current.x))));
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        html().removeAttribute("data-sidebar-resizing");
        store(WIDTH_KEY, String(Number.parseFloat(html().style.getPropertyValue("--sidebar-w-open")) || W_DEFAULT));
      }}
      onDoubleClick={() => {
        html().style.removeProperty("--sidebar-w-open");
        store(WIDTH_KEY, null);
      }}
      className="sidebar-resize group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
    >
      <span className="absolute inset-y-0 right-[3.5px] w-px bg-transparent transition-colors duration-100 group-hover:bg-border-strong group-active:bg-ring" />
    </div>
  );
}

/* ------------------------------------------------------------------ switcher */

function WorkspaceSwitcher({ businessName, folders, inApp }: { businessName: string; folders: ShellFolder[]; inApp: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initial = businessName.trim().charAt(0).toUpperCase() || "A";

  const open = (f: ShellFolder) => {
    if (f.isOpen) return;
    if (inApp) void appBridge()?.openFolder(f.dir);
    else startTransition(() => openFolder(f.dir));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-busy={pending || undefined}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors duration-100 hover:bg-hover aria-expanded:bg-hover aria-busy:opacity-70"
        >
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-foreground/90 text-[11px] leading-none font-semibold text-background"
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-semibold text-foreground">{businessName}</span>
          <ChevronDown className="size-3.5 shrink-0 text-tertiary" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px]">
        <DropdownMenuLabel>{t("nav.businesses")}</DropdownMenuLabel>
        {folders.map((f) => {
          const tone = f.status ? statusTone("business", f.status) : null;
          return (
            <DropdownMenuItem
              key={f.dir}
              onSelect={() => open(f)}
              className="h-auto items-start py-1.5"
              title={inApp && !f.isOpen ? t("nav.opensWindow") : undefined}
            >
              <span
                aria-hidden
                className="mt-px flex size-5 shrink-0 items-center justify-center rounded-sm bg-secondary text-[11px] leading-none font-semibold text-muted-foreground"
              >
                {f.name.trim().charAt(0).toUpperCase() || "·"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{f.name}</span>
                  {f.running && <span role="img" aria-label={t("nav.runningInBackground")} title={t("nav.runningInBackground")} className="size-1.5 shrink-0 rounded-full bg-success" />}
                  {tone && f.status !== "active" && <Badge tone={tone.tone}>{t(tone.label)}</Badge>}
                </span>
                <span className="block truncate text-xs text-tertiary">{f.path}</span>
              </span>
              {f.isOpen && <Check className="mt-0.5 size-4 text-foreground!" aria-label={t("nav.openHere")} />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {inApp ? (
          <>
            <DropdownMenuItem onSelect={() => void appBridge()?.showHome()}>
              <Home />
              {t("nav.allBusinesses")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void appBridge()?.showHome()}>
              <Plus />
              {t("nav.newBusiness")}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => router.push("/")}>
              <Home />
              {t("nav.allBusinesses")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push("/#new")}>
              <Plus />
              {t("nav.newBusiness")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ phone */

function BottomBar({ base, pending, onMenu }: { base: string; pending: number; onMenu: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const items: { href: string; label: MessageKey; icon: LucideIcon }[] = [
    { href: "", label: "nav.chat", icon: MessageSquare },
    { href: "/approvals", label: "nav.inbox", icon: Inbox },
    { href: "/deliverables", label: "nav.work", icon: FolderCheck },
  ];
  const inBar = items.some((i) => isActive(pathname, base, i.href));
  const cell = "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] leading-[14px] font-medium transition-colors duration-100";
  return (
    <nav
      aria-label={t("nav.menu")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
    >
      <div className="flex h-14 items-stretch px-2">
        {items.map((i) => {
          const active = isActive(pathname, base, i.href);
          const Icon = i.icon;
          return (
            <Link key={i.href} href={base + i.href} aria-current={active ? "page" : undefined} className={cn(cell, active ? "text-foreground" : "text-tertiary")}>
              <span className="relative">
                <Icon className="size-5" strokeWidth={active ? 2 : 1.75} aria-hidden />
                {i.href === "/approvals" && <CountPill count={pending} className="absolute -top-1.5 left-3" />}
              </span>
              {t(i.label)}
            </Link>
          );
        })}
        <button type="button" onClick={onMenu} className={cn(cell, inBar ? "text-tertiary" : "text-foreground")}>
          <Menu className="size-5" strokeWidth={inBar ? 1.75 : 2} aria-hidden />
          {t("nav.menu")}
        </button>
      </div>
    </nav>
  );
}
