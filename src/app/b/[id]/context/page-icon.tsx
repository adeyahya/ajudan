"use client";

import {
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  ChartColumn,
  ClipboardList,
  Clock,
  Coffee,
  CreditCard,
  DollarSign,
  FileText,
  Flag,
  Gift,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  House,
  Image as ImageIcon,
  Leaf,
  Lightbulb,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Music,
  Package,
  Palette,
  Phone,
  Receipt,
  Rocket,
  Scissors,
  ScrollText,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Shuffle,
  Sparkles,
  Star,
  Store,
  Table2,
  Tag,
  Target,
  Truck,
  Users,
  Utensils,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/i18n";
import { cn } from "@/components/kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Page icons (Notion-style): an emoji the owner picks, or one of a curated set of lucide
 * icons stored as "lucide:<name>". No emoji dependency: a curated list of 120.
 */

export const LUCIDE: Record<string, LucideIcon> = {
  store: Store,
  package: Package,
  "scroll-text": ScrollText,
  sparkles: Sparkles,
  users: Users,
  "file-text": FileText,
  table: Table2,
  "book-open": BookOpen,
  briefcase: Briefcase,
  building: Building2,
  calendar: Calendar,
  camera: Camera,
  chart: ChartColumn,
  clipboard: ClipboardList,
  clock: Clock,
  coffee: Coffee,
  card: CreditCard,
  dollar: DollarSign,
  flag: Flag,
  gift: Gift,
  globe: Globe,
  graduation: GraduationCap,
  handshake: Handshake,
  heart: Heart,
  house: House,
  image: ImageIcon,
  leaf: Leaf,
  lightbulb: Lightbulb,
  mail: Mail,
  "map-pin": MapPin,
  megaphone: Megaphone,
  message: MessageCircle,
  music: Music,
  palette: Palette,
  phone: Phone,
  receipt: Receipt,
  rocket: Rocket,
  scissors: Scissors,
  shield: ShieldCheck,
  shirt: Shirt,
  bag: ShoppingBag,
  cart: ShoppingCart,
  star: Star,
  tag: Tag,
  target: Target,
  truck: Truck,
  utensils: Utensils,
  wallet: Wallet,
  wrench: Wrench,
  box: Box,
};

export const EMOJI = [
  ..."📄📝📌📎📚📖📒📓📔📕📗📘📙🗂️🗃️🗒️📋📊📈📉🗓️📅⏰⌛💡🔑🔒🧭🎯🚀⭐✨🔥💎🏆🎉🎁🎨🖌️✂️🧵🪡🧶👕👗👜👟🧢💍📦🚚🛒🏷️💰💵💳🧾🏪🏬🏠🏢🏭🌏📍🗺️☕🍵🍜🍚🍞🍰🍩🍪🍫🍓🍌🥥🌶️🌿🌱🌸🌻🍀🌈☀️🌙⚡💧📷🎥🎬🎵🎤📣📢💬📞📧✉️🤝👋👍🙏💪🧑‍💼👩‍🍳👨‍🔧🧑‍🎨👥❤️💙💚💛🧡💜✅❗❓⚠️🛠️⚙️🔧🧪🧠",
]
  // Split into graphemes (the spread splits surrogate pairs and joiners).
  .join("")
  .match(/\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu) as string[];

/** The icon as an element: emoji text, a lucide icon, or the page / database glyph. */
export function PageIcon({ icon, kind = "page", size = 16, className }: { icon: string | null; kind?: "page" | "database"; size?: number; className?: string }) {
  if (icon?.startsWith("lucide:")) {
    const Icon = LUCIDE[icon.slice(7)] ?? FileText;
    return <Icon aria-hidden className={cn("shrink-0", className)} style={{ width: size, height: size }} strokeWidth={size > 24 ? 1.5 : 1.75} />;
  }
  if (icon) {
    return (
      <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center leading-none", className)} style={{ width: size, height: size, fontSize: size * 0.88 }}>
        {icon}
      </span>
    );
  }
  const Icon = kind === "database" ? Table2 : FileText;
  return <Icon aria-hidden className={cn("shrink-0", className)} style={{ width: size, height: size }} strokeWidth={size > 24 ? 1.5 : 1.75} />;
}

/**
 * The icon picker: Emoji / Icons tabs, a filter for icon names, Random and Remove.
 * Remove picks "" (no icon). Wraps `children` as the trigger (or pass `open` to
 * control it from a menu item, with `anchor` as the trigger).
 */
export function IconPicker({
  onPick,
  children,
  open,
  onOpenChange,
  align = "start",
}: {
  onPick: (icon: string | null) => void;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
}) {
  const t = useT();
  const [tab, setTab] = useState<"emoji" | "icons">("emoji");
  const [q, setQ] = useState("");
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = (o: boolean) => {
    setInner(o);
    onOpenChange?.(o);
  };
  const pick = (icon: string | null) => {
    onPick(icon);
    setOpen(false);
  };
  const icons = Object.keys(LUCIDE).filter((n) => !q.trim() || n.includes(q.trim().toLowerCase()));
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-[352px] gap-0 p-0">
        <div className="flex h-10 items-center gap-1 border-b border-border px-2">
          {(["emoji", "icons"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={cn(
                "h-7 rounded-md px-2 text-[13px] leading-[18px] font-medium transition-colors duration-100 hover:bg-hover",
                tab === k ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {t(k === "emoji" ? "context.icon.emoji" : "context.icon.icons")}
            </button>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => pick(tab === "emoji" ? EMOJI[Math.floor(Math.random() * EMOJI.length)] : `lucide:${Object.keys(LUCIDE)[Math.floor(Math.random() * Object.keys(LUCIDE).length)]}`)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground"
          >
            <Shuffle className="size-3.5" aria-hidden />
            {t("context.icon.random")}
          </button>
          <button type="button" onClick={() => pick("")} className="h-7 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground">
            {t("common.remove")}
          </button>
        </div>
        {tab === "icons" && (
          <div className="px-2 pt-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("context.icon.filter")}
              aria-label={t("context.icon.filter")}
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-[13px] outline-none placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
        )}
        <div className="max-h-[264px] overflow-y-auto p-2">
          {tab === "emoji" ? (
            <div className="grid grid-cols-10 gap-0.5">
              {EMOJI.map((e) => (
                <button key={e} type="button" onClick={() => pick(e)} aria-label={e} className="flex size-8 items-center justify-center rounded-md text-xl leading-none transition-colors duration-100 hover:bg-hover">
                  {e}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-10 gap-0.5">
              {icons.map((n) => {
                const Icon = LUCIDE[n];
                return (
                  <button
                    key={n}
                    type="button"
                    title={n}
                    aria-label={n}
                    onClick={() => pick(`lucide:${n}`)}
                    className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground"
                  >
                    <Icon className="size-[18px]" strokeWidth={1.75} />
                  </button>
                );
              })}
              {!icons.length && <p className="col-span-10 py-4 text-center text-[13px] text-muted-foreground">{t("context.icon.none")}</p>}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
