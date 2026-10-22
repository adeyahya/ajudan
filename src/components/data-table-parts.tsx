"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/lib/utils";

/** Client pieces of src/components/data-table.tsx (import from there, not here). */

const RowOpen = createContext<(() => void) | null>(null);

/** A focusable, clickable table row: Enter/Space/click opens, ↑↓ move between rows. */
export function RowShell({
  href,
  onOpen,
  selected,
  className,
  children,
}: {
  href?: string;
  onOpen?: () => void;
  selected?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const interactive = Boolean(href || onOpen);
  const open = () => {
    if (onOpen) onOpen();
    else if (href) router.push(href, { scroll: false });
  };
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      (sib as HTMLElement | null)?.focus();
    }
  };
  return (
    <RowOpen.Provider value={interactive ? open : null}>
      <tr
        tabIndex={interactive ? 0 : undefined}
        aria-selected={interactive ? Boolean(selected) : undefined}
        onClick={interactive ? (e: MouseEvent) => !(e.target as HTMLElement).closest("a,button,input,label,[role=checkbox],[role=switch]") && open() : undefined}
        onKeyDown={interactive ? onKey : undefined}
        className={cn(
          "group/row h-[34px] border-b border-border/70 transition-colors duration-100 outline-none focus-visible:bg-hover focus-visible:shadow-[inset_2px_0_0_var(--ring)]",
          interactive && "cursor-pointer hover:bg-hover",
          selected && "bg-primary-soft hover:bg-primary-soft",
          className,
        )}
      >
        {children}
      </tr>
    </RowOpen.Provider>
  );
}

/** The hover-revealed "Open" button in a row's first cell. */
export function RowOpenButton() {
  const t = useT();
  const open = useContext(RowOpen);
  if (!open) return null;
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={open}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-xs font-medium text-muted-foreground opacity-0 shadow-xs transition-opacity duration-100 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 hover:bg-hover hover:text-foreground"
    >
      <ArrowUpRight className="size-3.5" aria-hidden />
      {t("table.open")}
    </button>
  );
}

/** Small search box for toolbars (28px, icon, borderless until hover/focus), 224px. */
export function TableSearch({
  value,
  defaultValue,
  onChange,
  placeholder,
  name = "q",
  className,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  name?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <label className={cn("relative flex h-7 w-56 max-w-full items-center", className)}>
      <Search className="pointer-events-none absolute left-2 size-3.5 text-tertiary" aria-hidden />
      <input
        type="search"
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder ?? t("table.search")}
        aria-label={placeholder ?? t("table.search")}
        className="h-7 w-full rounded-md border border-transparent bg-transparent pr-2 pl-7 text-[13px] text-foreground transition-[border-color,background-color,box-shadow] duration-100 outline-none placeholder:text-placeholder hover:bg-hover focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </label>
  );
}
