"use client";

import { ListFilter } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";
import { Avatar, Button, cn } from "@/components/kit";
import { TableSearch } from "@/components/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { kindLabel } from "./format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The Work toolbar's client parts. Both write the page's search params (`?kind=` and
 * `?teammate=` may repeat; `?q=` searches titles) with router.replace, so the server page
 * re-queries and a reload or a shared link keeps the view. The open peek (`?d=`) stays.
 */

function useParamWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const write = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  return { params, write };
}

export function WorkFilters({ kinds, mates }: { kinds: string[]; mates: { id: string; name: string; color: string }[] }) {
  const t = useT();
  const { params, write } = useParamWriter();
  const selKinds = params.getAll("kind");
  const selMates = params.getAll("teammate");
  const active = selKinds.length + selMates.length;

  const toggle = (key: "kind" | "teammate", value: string) =>
    write((p) => {
      const cur = p.getAll(key);
      p.delete(key);
      for (const v of cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]) p.append(key, v);
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn(active > 0 ? "text-primary hover:text-primary" : "text-muted-foreground")}>
          <ListFilter aria-hidden />
          {t("table.filter")}
          {active > 0 && <span className="tabular-nums">· {active}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {kinds.length > 0 && (
          <FilterGroup label={t("work.filter.kind")}>
            {kinds.map((k) => (
              <FilterRow key={k} checked={selKinds.includes(k)} onToggle={() => toggle("kind", k)}>
                <span className="truncate">{kindLabel(k)}</span>
              </FilterRow>
            ))}
          </FilterGroup>
        )}
        {mates.length > 0 && (
          <FilterGroup label={t("work.filter.teammate")}>
            {mates.map((m) => (
              <FilterRow key={m.id} checked={selMates.includes(m.id)} onToggle={() => toggle("teammate", m.id)}>
                <Avatar seed={m.id} name={m.name} color={m.color} size={20} />
                <span className="truncate">{m.name}</span>
              </FilterRow>
            ))}
          </FilterGroup>
        )}
        {active > 0 && (
          <>
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() =>
                write((p) => {
                  p.delete("kind");
                  p.delete("teammate");
                })
              }
              className="flex h-7 w-full items-center rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              {t("work.filter.clear")}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="py-1 [&+&]:border-t [&+&]:border-border">
      <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-tertiary">{label}</div>
      <div className="max-h-56 overflow-y-auto overscroll-contain pb-1">{children}</div>
    </div>
  );
}

function FilterRow({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground hover:bg-hover has-focus-visible:bg-hover">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {children}
    </label>
  );
}

/** Title search, debounced; Esc clears. */
export function WorkSearch() {
  const t = useT();
  const { params, write } = useParamWriter();
  const [value, setValue] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const push = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () =>
        write((p) => {
          if (v.trim()) p.set("q", v.trim());
          else p.delete("q");
        }),
      250,
    );
  };
  return (
    <TableSearch
      value={value}
      placeholder={t("work.search")}
      className="w-auto min-w-0 flex-1 sm:w-56 sm:flex-none"
      onChange={(v) => {
        setValue(v);
        push(v);
      }}
    />
  );
}
