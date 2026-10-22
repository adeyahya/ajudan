"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useT } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: MessageKey; icon: string }[] = [
  { href: "/manager", label: "nav.manager", icon: "★" },
  { href: "", label: "nav.office", icon: "▦" },
  { href: "/approvals", label: "nav.approvals", icon: "✉" },
  { href: "/desk", label: "nav.desk", icon: "☎" },
  { href: "/deliverables", label: "nav.work", icon: "▤" },
  { href: "/studio", label: "nav.studio", icon: "✦" },
  { href: "/files", label: "nav.files", icon: "▥" },
  { href: "/team", label: "nav.team", icon: "☺" },
  { href: "/onboarding", label: "nav.interview", icon: "✎" },
  { href: "/profile", label: "nav.business", icon: "⌂" },
];

/** Game-menu tabs: the active one is a raised gold tab. With hideInterview, that tab only shows while you're on it. */
export function BusinessNav({ hideInterview = false }: { hideInterview?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const t = useT();
  const base = `/b/${id}`;
  return (
    <nav className="overflow-x-auto bg-[#241b29] px-4 shadow-[inset_0_-3px_0_var(--frame)] sm:px-6">
      <div className="mx-auto flex max-w-6xl gap-1.5 pt-2">
        {TABS.map((tab) => {
          const href = base + tab.href;
          const active =
            tab.href === "" ? pathname === base || pathname.startsWith(`${base}/teammates`) : pathname === href || pathname.startsWith(`${href}/`);
          if (hideInterview && tab.href === "/onboarding" && !active) return null;
          return (
            <Link
              key={tab.href}
              href={href}
              className={cn(
                "font-pixel mx-[3px] mt-[3px] flex items-center gap-1.5 whitespace-nowrap px-3 pb-1.5 pt-1 text-sm transition-transform",
                active
                  ? "bg-primary text-primary-foreground shadow-[-3px_0_0_var(--frame),3px_0_0_var(--frame),0_-3px_0_var(--frame),inset_0_3px_0_rgb(255_255_255/0.35)]"
                  : "translate-y-1 bg-secondary text-muted-foreground shadow-[-3px_0_0_var(--frame),3px_0_0_var(--frame),0_-3px_0_var(--frame)] hover:translate-y-0.5 hover:text-foreground",
              )}
            >
              <span aria-hidden className="text-xs opacity-80">
                {tab.icon}
              </span>
              {t(tab.label)}
            </Link>
          );
        })}
        <Link
          href={`${base}/health`}
          title={t("nav.healthTitle")}
          className={cn(
            "ml-auto self-center whitespace-nowrap px-2 pb-1 text-xs hover:text-foreground",
            pathname === `${base}/health` ? "text-foreground underline" : "text-muted-foreground",
          )}
        >
          {t("nav.health")}
        </Link>
      </div>
    </nav>
  );
}
