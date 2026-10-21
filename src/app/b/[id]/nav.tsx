"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/components/kit";

const TABS = [
  { href: "", label: "Office" },
  { href: "/approvals", label: "Approvals" },
  { href: "/deliverables", label: "Work" },
  { href: "/team", label: "Team" },
  { href: "/onboarding", label: "Interview" },
  { href: "/profile", label: "Business" },
];

export function BusinessNav() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const base = `/b/${id}`;
  return (
    <nav className="border-b border-border px-4 sm:px-6 overflow-x-auto">
      <div className="flex gap-1 max-w-6xl mx-auto">
        {TABS.map((t) => {
          const href = base + t.href;
          const active = t.href === "" ? pathname === base || pathname.startsWith(`${base}/teammates`) : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={t.href}
              href={href}
              className={cn(
                "px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap",
                active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
