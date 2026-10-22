"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "", label: "Library", icon: "▦" },
  { href: "/docs", label: "Docs", icon: "✎" },
  { href: "/contacts", label: "Contacts", icon: "☺" },
  { href: "/video", label: "Video editor", icon: "▶" },
  { href: "/audio", label: "Audio editor", icon: "♪" },
];

export function StudioNav() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const base = `/b/${id}/studio`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-pixel mr-2 text-lg text-primary drop-shadow-[2px_2px_0_var(--frame)]">✦ Studio</span>
      {TABS.map((t) => {
        const href = base + t.href;
        const active = t.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "font-pixel inline-flex items-center gap-1.5 rounded-[3px] border-2 border-frame px-2.5 py-0.5 text-sm",
              active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden className="text-xs opacity-80">
              {t.icon}
            </span>
            {t.label}
          </Link>
        );
      })}
      <span className="ml-auto text-xs text-muted-foreground">No Claude usage here: works while the team rests.</span>
    </div>
  );
}
