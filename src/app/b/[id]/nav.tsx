"use client";

import {
  Activity,
  BookOpen,
  Building2,
  Ellipsis,
  Folder,
  FolderCheck,
  Headset,
  Inbox,
  MessageCircle,
  PenLine,
  Sparkles,
  Store,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Item = { href: string; label: MessageKey; icon: LucideIcon; title?: MessageKey };

/** Where the owner spends the day. Chat is home: the manager, with the office above it. */
const PRIMARY: Item[] = [
  { href: "", label: "nav.chat", icon: MessageCircle },
  { href: "/office", label: "nav.office", icon: Building2 },
  { href: "/approvals", label: "nav.approvals", icon: Inbox },
  { href: "/deliverables", label: "nav.work", icon: FolderCheck },
  { href: "/context", label: "nav.context", icon: BookOpen },
  { href: "/team", label: "nav.team", icon: Users },
];

/** Everything else, lower in the rail (under "More" on a phone). */
const SECONDARY: Item[] = [
  { href: "/desk", label: "nav.desk", icon: Headset },
  { href: "/studio", label: "nav.studio", icon: Sparkles },
  { href: "/files", label: "nav.files", icon: Folder },
  { href: "/onboarding", label: "nav.interview", icon: PenLine },
  { href: "/profile", label: "nav.business", icon: Store },
  { href: "/health", label: "nav.health", icon: Activity, title: "nav.healthTitle" },
];

/** The phone's bottom bar: four destinations and More. */
const PHONE_BAR = ["", "/office", "/approvals", "/deliverables"];

function isActive(pathname: string, base: string, href: string) {
  if (href === "") return pathname === base || pathname === `${base}/manager` || pathname.startsWith(`${base}/teammates/`);
  return pathname === base + href || pathname.startsWith(`${base}${href}/`);
}

/** Chat pages fill the viewport (the conversation scrolls inside), so they get a wider, tighter frame. */
export function isChatRoute(pathname: string, base: string) {
  return isActive(pathname, base, "");
}

/**
 * The business's navigation: a compact left rail from md up, a bottom bar with a More
 * sheet on a phone. With hideInterview, the Interview item only shows while you're on it.
 */
export function BusinessRail({ hideInterview = false, pendingApprovals = 0 }: { hideInterview?: boolean; pendingApprovals?: number }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const base = `/b/${id}`;
  const secondary = SECONDARY.filter((i) => !(hideInterview && i.href === "/onboarding" && !isActive(pathname, base, i.href)));
  const badge = (href: string) => (href === "/approvals" && pendingApprovals > 0 ? pendingApprovals : 0);

  const railLink = (item: Item, small = false) => {
    const active = isActive(pathname, base, item.href);
    const Icon = item.icon;
    const count = badge(item.href);
    return (
      <Link
        key={item.href}
        href={base + item.href}
        title={item.title ? t(item.title) : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex w-full flex-col items-center gap-1 rounded-md px-1 text-center transition-colors duration-200",
          small ? "py-1.5" : "py-2",
          active ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)]" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <Icon aria-hidden className={small ? "size-4" : "size-5"} strokeWidth={1.75} />
        <span className={cn("leading-none", small ? "text-[10px]" : "font-pixel text-[11px]")}>{t(item.label)}</span>
        {count > 0 && <CountDot count={count} />}
      </Link>
    );
  };

  return (
    <>
      <nav
        aria-label={t("nav.menu")}
        className="sticky top-0 hidden h-[calc(100dvh-3rem)] w-[4.75rem] shrink-0 flex-col gap-1 self-start overflow-y-auto border-r-[3px] border-sidebar-border bg-sidebar px-1.5 py-3 md:flex"
      >
        {PRIMARY.map((i) => railLink(i))}
        <div className="mt-auto space-y-0.5 border-t border-sidebar-accent pt-2">{secondary.map((i) => railLink(i, true))}</div>
      </nav>

      <nav
        aria-label={t("nav.menu")}
        className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {moreOpen && (
          <div className="absolute inset-x-2 bottom-full mb-2 grid grid-cols-4 gap-1 rounded-md border-2 border-sidebar-border bg-sidebar p-2 shadow-[0_-6px_24px_rgb(0_0_0/0.35)]">
            {[...PRIMARY.filter((i) => !PHONE_BAR.includes(i.href)), ...secondary].map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, base, item.href);
              return (
                <Link
                  key={item.href}
                  href={base + item.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px]",
                    active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent",
                  )}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                  {t(item.label)}
                </Link>
              );
            })}
          </div>
        )}
        <div className="flex h-16 items-stretch justify-around px-1">
          {PRIMARY.filter((i) => PHONE_BAR.includes(i.href)).map((item) => (
            <BarItem
              key={item.href}
              href={base + item.href}
              active={isActive(pathname, base, item.href)}
              icon={item.icon}
              label={t(item.label)}
              onClick={() => setMoreOpen(false)}
            >
              {badge(item.href) > 0 && <CountDot count={badge(item.href)} />}
            </BarItem>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px]",
              moreOpen ? "text-sidebar-primary" : "text-sidebar-foreground/70",
            )}
          >
            {moreOpen ? <X aria-hidden className="size-5" strokeWidth={1.75} /> : <Ellipsis aria-hidden className="size-5" strokeWidth={1.75} />}
            <span className="font-pixel">{t("nav.more")}</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function BarItem({
  href,
  active,
  icon: Icon,
  label,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors",
        active ? "text-sidebar-primary" : "text-sidebar-foreground/70",
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={active ? 2.25 : 1.75} />
      <span className="font-pixel">{label}</span>
      {children}
    </Link>
  );
}

function CountDot({ count }: { count: number }) {
  return (
    <span className="absolute right-1.5 top-1 min-w-4 rounded-full bg-warn px-1 text-[10px] font-semibold leading-4 text-ink tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** The page frame next to the rail: chat routes fill the viewport, other pages keep the reading width. */
export function MainFrame({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const chat = isChatRoute(pathname, `/b/${id}`);
  return (
    <main
      className={cn(
        "w-full flex-1 mx-auto",
        // --chrome-h: what the viewport loses to the header, this frame's padding and (on a phone) the bottom bar.
        chat
          ? "max-w-[1480px] px-3 pt-3 pb-[5rem] sm:px-4 md:pb-3 [--chrome-h:9rem] md:[--chrome-h:4.5rem]"
          : "max-w-6xl px-4 pt-6 pb-24 sm:px-6 md:pb-6",
      )}
    >
      {children}
    </main>
  );
}
