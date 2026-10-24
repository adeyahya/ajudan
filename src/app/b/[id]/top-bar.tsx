"use client";

import { ChevronRight, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { usePageCrumbs, useActionsSlot, type Crumb } from "@/components/breadcrumb";
import { useT } from "@/components/i18n";
import { IconButton } from "@/components/kit";
import { useModKey } from "@/components/shortcuts";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The 44px bar above every business page: the open-sidebar button (phone, or when the
 * sidebar is collapsed), breadcrumbs `Business › Section › …page crumbs`, and a right
 * slot that pages fill with <TopBarActions> (src/components/breadcrumb.tsx).
 * A hairline appears under it once the page scrolls.
 */

const SECTIONS: Record<string, MessageKey> = {
  home: "nav.home",
  docs: "nav.docs",
  library: "nav.library",
  contacts: "nav.contacts",
  trash: "nav.trash",
  office: "nav.office",
  approvals: "nav.inbox",
  deliverables: "nav.work",
  context: "nav.context",
  team: "nav.team",
  desk: "nav.desk",
  studio: "nav.studio",
  files: "nav.files",
  profile: "nav.business",
  health: "nav.health",
  onboarding: "nav.interview",
};

export function TopBar({
  businessId,
  businessName,
  teammates,
  onOpenSidebar,
}: {
  businessId: string;
  businessName: string;
  teammates: { id: string; name: string }[];
  onOpenSidebar: () => void;
}) {
  const t = useT();
  const mod = useModKey();
  const pathname = usePathname();
  const pageCrumbs = usePageCrumbs();
  const setActionsEl = useActionsSlot();
  const [scrolled, setScrolled] = useState(false);
  const base = `/b/${businessId}`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const rest = pathname.startsWith(base) ? pathname.slice(base.length).split("/").filter(Boolean) : [];
  const crumbs: Crumb[] = [{ label: businessName, href: base }];
  const [section, sub] = rest;
  if (!section || section === "teammates" || section === "manager") {
    crumbs.push({ label: t("nav.chat"), href: base });
    if (section === "teammates" && sub) crumbs.push({ label: teammates.find((m) => m.id === sub)?.name ?? "…" });
    if (section === "manager") crumbs.push({ label: t("nav.manager") });
  } else if (SECTIONS[section]) {
    // The Studio's own index only redirects to the library: its crumb opens the video editor.
    crumbs.push({ label: t(SECTIONS[section]), href: section === "studio" ? `${base}/studio/video` : `${base}/${section}` });
  }
  crumbs.push(...pageCrumbs);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-(--topbar-h) shrink-0 items-center gap-1 bg-background/95 px-3 backdrop-blur-sm transition-shadow duration-150",
        scrolled && "shadow-[0_1px_0_var(--border)]",
      )}
    >
      <IconButton label={t("nav.openSidebar")} shortcut={`${mod}\\`} onClick={onOpenSidebar} className="sidebar-open-button -ml-1">
        <PanelLeftOpen />
      </IconButton>
      <nav aria-label={t("nav.breadcrumb")} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-0.5 text-[13px] leading-[18px]">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            // On a phone only the last two crumbs fit.
            const hideOnPhone = i < crumbs.length - 2;
            return (
              <Fragment key={i}>
                {i > 0 && (
                  <li aria-hidden className={cn("shrink-0 text-placeholder", hideOnPhone && "hidden sm:block", i === crumbs.length - 2 && "hidden sm:block")}>
                    <ChevronRight className="size-3.5" />
                  </li>
                )}
                <li className={cn("min-w-0", last ? "shrink" : "shrink-[2]", hideOnPhone && "hidden sm:block")}>
                  {c.href && !last ? (
                    <Link href={c.href} className="block truncate rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className="block truncate px-1.5 py-0.5 font-medium text-foreground">
                      {c.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
      <div ref={setActionsEl} className="flex shrink-0 items-center gap-1 empty:hidden" />
    </header>
  );
}
