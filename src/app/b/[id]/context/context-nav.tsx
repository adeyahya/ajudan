"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useT } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: MessageKey; icon: string }[] = [
  { href: "", label: "context.tab.pages", icon: "❖" },
  { href: "/people", label: "context.tab.people", icon: "☺" },
  { href: "/readers", label: "context.tab.readers", icon: "◎" },
];

/** Pages, the people database, and the inspector of what each teammate reads. */
export function ContextNav() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const t = useT();
  const base = `/b/${id}/context`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-pixel mr-2 text-lg text-primary drop-shadow-[2px_2px_0_var(--frame)]">❖ {t("context.title")}</span>
      {TABS.map((tab) => {
        const href = base + tab.href;
        const active = tab.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              "font-pixel inline-flex items-center gap-1.5 rounded-[3px] border-2 border-frame px-2.5 py-0.5 text-sm",
              active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden className="text-xs opacity-80">
              {tab.icon}
            </span>
            {t(tab.label)}
          </Link>
        );
      })}
      <span className="ml-auto hidden text-xs text-muted-foreground md:inline">{t("context.subtitle")}</span>
    </div>
  );
}
