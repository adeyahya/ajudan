"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/manager", label: "Manager", icon: "★" },
  { href: "", label: "Office", icon: "▦" },
  { href: "/approvals", label: "Approvals", icon: "✉" },
  { href: "/deliverables", label: "Work", icon: "▤" },
  { href: "/files", label: "Files", icon: "▥" },
  { href: "/team", label: "Team", icon: "☺" },
  { href: "/onboarding", label: "Interview", icon: "✎" },
  { href: "/profile", label: "Business", icon: "⌂" },
];

/** Game-menu tabs: the active one is a raised gold tab. With hideInterview, that tab only shows while you're on it. */
export function BusinessNav({ hideInterview = false }: { hideInterview?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const base = `/b/${id}`;
  return (
    <nav className="overflow-x-auto bg-[#241b29] px-4 shadow-[inset_0_-3px_0_var(--frame)] sm:px-6">
      <div className="mx-auto flex max-w-6xl gap-1.5 pt-2">
        {TABS.map((t) => {
          const href = base + t.href;
          const active =
            t.href === "" ? pathname === base || pathname.startsWith(`${base}/teammates`) : pathname === href || pathname.startsWith(`${href}/`);
          if (hideInterview && t.href === "/onboarding" && !active) return null;
          return (
            <Link
              key={t.href}
              href={href}
              className={cn(
                "font-pixel mx-[3px] mt-[3px] flex items-center gap-1.5 whitespace-nowrap px-3 pb-1.5 pt-1 text-sm transition-transform",
                active
                  ? "bg-primary text-primary-foreground shadow-[-3px_0_0_var(--frame),3px_0_0_var(--frame),0_-3px_0_var(--frame),inset_0_3px_0_rgb(255_255_255/0.35)]"
                  : "translate-y-1 bg-secondary text-muted-foreground shadow-[-3px_0_0_var(--frame),3px_0_0_var(--frame),0_-3px_0_var(--frame)] hover:translate-y-0.5 hover:text-foreground",
              )}
            >
              <span aria-hidden className="text-xs opacity-80">
                {t.icon}
              </span>
              {t.label}
            </Link>
          );
        })}
        <Link
          href={`${base}/health`}
          title="Jobs & health: worker, queue, failures, spend, backups"
          className={cn(
            "ml-auto self-center whitespace-nowrap px-2 pb-1 text-xs hover:text-foreground",
            pathname === `${base}/health` ? "text-foreground underline" : "text-muted-foreground",
          )}
        >
          Health
        </Link>
      </div>
    </nav>
  );
}
