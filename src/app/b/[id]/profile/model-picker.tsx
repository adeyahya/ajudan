// Client-only: used by backend-panel.tsx (a client component), so `load` can be a plain function.
import { Check, ChevronsUpDown, Eye, Loader2, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/components/i18n";
import { tagClass } from "@/components/kit";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ModelOption } from "@/lib/backend";
import { cn } from "@/lib/utils";

type Sort = "newest" | "price" | "context";

/**
 * A searchable model picker for Business → AI backend: price per million tokens,
 * context size, tool and image support, filters (free, can use tools) and sorting.
 * The choice goes into a hidden input `name`; typing an id that isn't listed can be
 * used as-is. `defaultLabel` adds a first row that clears the choice (provider default).
 */
export function ModelPicker({
  id,
  name,
  defaultValue,
  load,
  placeholder,
  defaultLabel,
  prices = false,
}: {
  id: string;
  name: string;
  defaultValue: string;
  load: () => Promise<{ models: ModelOption[]; error?: string }>;
  placeholder: string;
  defaultLabel?: string;
  prices?: boolean;
}) {
  const t = useT();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [toolsOnly, setToolsOnly] = useState(true);
  const [freeOnly, setFreeOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");

  const openPicker = (next: boolean) => {
    setOpen(next);
    if (next && !models) {
      void load().then((r) => {
        setModels(r.models);
        setError(r.error);
      });
    }
  };

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = (models ?? []).filter(
      (m) =>
        (!toolsOnly || m.tools !== false) &&
        (!freeOnly || m.free) &&
        words.every((w) => m.id.toLowerCase().includes(w) || m.name.toLowerCase().includes(w)),
    );
    const cost = (m: ModelOption) => (m.price ? m.price.input + m.price.output : Number.POSITIVE_INFINITY);
    if (sort === "price") list.sort((a, b) => cost(a) - cost(b));
    if (sort === "context") list.sort((a, b) => (b.context ?? 0) - (a.context ?? 0));
    return { matched: list.length, list: list.slice(0, 150) };
  }, [models, query, toolsOnly, freeOnly, sort]);

  const selected = models?.find((m) => m.id === value);
  const typed = query.trim();
  const choose = (v: string) => {
    setValue(v);
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Popover open={open} onOpenChange={openPicker}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left text-[13px] transition-colors hover:bg-hover/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span className={cn("min-w-0 flex-1 truncate", value ? "font-mono text-foreground" : "text-placeholder")}>
              {value ? (selected?.name && selected.name !== value ? `${selected.name} · ${value}` : value) : (defaultLabel ?? placeholder)}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-tertiary" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(560px,calc(100vw-32px))] gap-0 p-0">
          <Command shouldFilter={false} className="rounded-lg">
            <CommandInput value={query} onValueChange={setQuery} placeholder={t("profile.backend.picker.search")} className="text-sm" />
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 text-xs">
              <Chip on={toolsOnly} onClick={() => setToolsOnly(!toolsOnly)}>
                <Wrench className="size-3" /> {t("profile.backend.picker.tools")}
              </Chip>
              {prices && (
                <Chip on={freeOnly} onClick={() => setFreeOnly(!freeOnly)}>
                  {t("profile.backend.picker.free")}
                </Chip>
              )}
              <span className="ml-auto flex items-center gap-1 text-tertiary">
                {t("profile.backend.picker.sort")}
                {(prices ? (["newest", "price", "context"] as const) : (["newest", "context"] as const)).map((s) => (
                  <Chip key={s} on={sort === s} onClick={() => setSort(s)}>
                    {t(`profile.backend.picker.sort.${s}`)}
                  </Chip>
                ))}
              </span>
            </div>
            <CommandList className="max-h-[380px]">
              {!models ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {t("profile.backend.picker.loading")}
                </div>
              ) : (
                <>
                  {error && <p className="px-3 py-2 text-xs text-muted-foreground">{error}</p>}
                  <CommandEmpty>{t("profile.backend.picker.none")}</CommandEmpty>
                  {defaultLabel && !typed && (
                    <CommandGroup>
                      <CommandItem value="__default" onSelect={() => choose("")}>
                        <Check className={cn("size-4", value ? "opacity-0" : "")} />
                        <span className="text-[13px]">{defaultLabel}</span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                  <CommandGroup heading={models.length ? t("profile.backend.picker.count", { shown: String(shown.matched), all: String(models.length) }) : undefined}>
                    {shown.list.map((m) => (
                      <CommandItem key={m.id} value={m.id} onSelect={() => choose(m.id)} className="h-auto items-start py-1.5">
                        <Check className={cn("mt-0.5 size-4", value === m.id ? "" : "opacity-0")} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium">{m.name}</span>
                            {m.free && <span className={cn("rounded px-1 text-[11px] font-medium", tagClass("green"))}>{t("profile.backend.picker.free")}</span>}
                            {m.tools && <Wrench className="size-3 text-tertiary" aria-label={t("profile.backend.picker.tools")} />}
                            {m.vision && <Eye className="size-3 text-tertiary" aria-label={t("profile.backend.picker.vision")} />}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[m.id !== m.name ? m.id : "", m.context ? `${formatTokens(m.context)} ${t("profile.backend.picker.context")}` : "", prices ? priceLabel(m, t("profile.backend.picker.varies")) : "", m.note ?? ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {typed && !models.some((m) => m.id === typed) && (
                    <CommandGroup>
                      <CommandItem value={`__custom:${typed}`} onSelect={() => choose(typed)}>
                        <span className="text-[13px]">{t("profile.backend.picker.useTyped", { id: typed })}</span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
        on ? cn("border-transparent font-medium", tagClass("blue")) : "border-border text-muted-foreground hover:bg-hover/50",
      )}
    >
      {children}
    </button>
  );
}

function formatTokens(n: number) {
  return n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`;
}

function priceLabel(m: ModelOption, varies: string) {
  if (m.free) return "";
  if (!m.price) return varies;
  const f = (v: number) => (v < 1 ? `$${+v.toFixed(2)}` : `$${+v.toFixed(1)}`);
  return `${f(m.price.input)} / ${f(m.price.output)} per 1M`;
}
