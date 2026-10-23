import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label as ShadcnLabel } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/markdown";
import { PixelPortrait } from "@/components/pixel-portrait";
import { STATE_DOT, type DotState, type TagTone } from "@/lib/status-tones";
import { cn } from "@/lib/utils";

/**
 * App-level building blocks on top of shadcn/ui (src/components/ui), per docs/UI-PLAN.md §2.
 * Server- and client-safe: nothing here uses hooks, so server pages can render all of it
 * (props that are functions, like ConfirmDialog's onConfirm, need a client caller).
 *
 * Layout     PageBody · PageHeader · Section · PropertyList · LineTabs
 * Controls   Button · IconButton · Input · Textarea · Label · Field · ConfirmDialog · Kbd
 * Display    Badge · CountPill · StatusDot · Avatar · Card · Prose · EmptyState · PixelLogo
 * Loading    Skeleton · PageSkeleton · ListSkeleton · TableSkeleton · ChatSkeleton ·
 *            EditorSkeleton · CardGridSkeleton
 *
 * Type roles (use these recipes, never text-[10px]):
 *   doc title   text-[40px] leading-[48px] font-bold tracking-[-0.02em]
 *   page title  text-[28px] leading-[34px] font-bold tracking-tight   (PageHeader)
 *   section     text-base font-semibold                                (Section)
 *   label       text-[13px] leading-[18px] font-medium
 *   body        text-sm leading-[22px]
 *   caption     text-xs                                                (meta, timestamps)
 *   micro 11px  only inside Badge / Kbd / CountPill
 */

export { cn, Kbd, Skeleton };

/* ------------------------------------------------------------------ controls */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

const variantMap = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
  subtle: "subtle",
} as const;

/**
 * App button. `variant`: primary (blue) · secondary (outline) · ghost · subtle (grey) ·
 * danger (red text). `size`: sm 28px (toolbars, rows, cards) · default 32px · lg 36px
 * (onboarding/home CTAs only) · icon-sm · icon. `loading` shows a spinner.
 */
export function Button({
  variant = "primary",
  size = "default",
  ...props
}: Omit<ComponentProps<typeof ShadcnButton>, "variant"> & { variant?: ButtonVariant }) {
  return <ShadcnButton variant={variantMap[variant]} size={size} {...props} />;
}

/**
 * Icon-only button with a tooltip and an aria-label (every icon button needs both).
 *   <IconButton label="Close" onClick={…}><X /></IconButton>
 * `shortcut` shows a Kbd in the tooltip ("⌘\\"). Default: ghost, 28px.
 */
export function IconButton({
  label,
  shortcut,
  side = "bottom",
  variant = "ghost",
  size = "icon-sm",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof ShadcnButton>, "variant" | "size"> & {
  label: string;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  variant?: ButtonVariant;
  size?: "icon-xs" | "icon-sm" | "icon";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ShadcnButton
          variant={variantMap[variant]}
          size={size}
          aria-label={label}
          className={cn(variant === "ghost" && "text-tertiary hover:text-foreground aria-expanded:text-foreground", className)}
          {...props}
        >
          {children}
        </ShadcnButton>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export const Input = ShadcnInput;
export const Textarea = ShadcnTextarea;

export function Label({ className, ...props }: ComponentProps<typeof ShadcnLabel>) {
  return <ShadcnLabel className={cn("text-[13px] leading-[18px] font-medium text-foreground", className)} {...props} />;
}

/**
 * A form field: label 13/18 500, the control, then hint (12 muted) or error (12 red).
 * Lay forms out as `grid gap-4`.
 *   <Field label="Website" hint="Optional" htmlFor="w"><Input id="w" name="website" /></Field>
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <ShadcnLabel htmlFor={htmlFor} className="text-[13px] leading-[18px] font-medium text-foreground">
        {label}
      </ShadcnLabel>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * Replaces window.confirm(). Uncontrolled: wraps a trigger.
 *   <ConfirmDialog trigger={<Button variant="danger" size="sm">Delete</Button>}
 *     title="Delete this page?" body="…" confirmLabel="Delete" cancelLabel="Cancel"
 *     destructive onConfirm={() => startTransition(() => deleteAction(id))} />
 */
export function ConfirmDialog({
  trigger,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
}: {
  trigger: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body && <AlertDialogDescription>{body}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(destructive && "bg-destructive! text-white! hover:bg-destructive/90! focus-visible:outline-destructive")}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ display */

/** A hairline box, 6px radius, no shadow. Use for lists/callouts only; sections need no box. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-md border border-border bg-card text-card-foreground", className)} {...props} />;
}

/** Old tone names (still accepted) → the tag set. */
type LegacyTone = "neutral" | "amber" | "violet";
export type BadgeTone = TagTone | LegacyTone;

const TAG: Record<TagTone, string> = {
  gray: "bg-tag-gray-bg text-tag-gray-fg",
  brown: "bg-tag-brown-bg text-tag-brown-fg",
  orange: "bg-tag-orange-bg text-tag-orange-fg",
  yellow: "bg-tag-yellow-bg text-tag-yellow-fg",
  green: "bg-tag-green-bg text-tag-green-fg",
  blue: "bg-tag-blue-bg text-tag-blue-fg",
  purple: "bg-tag-purple-bg text-tag-purple-fg",
  pink: "bg-tag-pink-bg text-tag-pink-fg",
  red: "bg-tag-red-bg text-tag-red-fg",
};
const LEGACY: Record<LegacyTone, TagTone> = { neutral: "gray", amber: "yellow", violet: "purple" };

/** Tone → the tag's bg/fg classes (for chips that aren't a Badge, e.g. a select value). */
export const tagClass = (tone: BadgeTone) => TAG[(LEGACY as Record<string, TagTone>)[tone] ?? (tone as TagTone)];

/**
 * A Notion tag: 20px, 4px radius, 12px 500. Tones: gray brown orange yellow green blue
 * purple pink red (neutral/amber/violet still work). For statuses use `statusTone()` from
 * @/lib/status-tones so all pages agree.
 */
export function Badge({
  tone = "gray",
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center gap-1 truncate rounded-sm px-1.5 text-xs leading-4 font-medium whitespace-nowrap [&_svg]:size-3.5",
        tagClass(tone),
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Ink count pill (Inbox count, sidebar): 18px, 11/14 600, tabular. Renders nothing for 0. */
export function CountPill({ count, max = 99, className }: { count: number; max?: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] leading-[14px] font-semibold text-background tabular-nums",
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

/** 8px status dot (teammate state). Pass a state from `stateDot(teammate.state)`. */
export function StatusDot({ state, className, label }: { state: DotState; className?: string; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-2 shrink-0 rounded-full", STATE_DOT[state], className)}
    />
  );
}

/**
 * Teammate avatar (the office chibi). Pass `seed` = teammate id. Sizes: 16 inline, 20 menus,
 * 24 rows/feeds, 28 chat, 32 lists, 40 headers, 64 empty states. `status` adds a dot.
 */
export function Avatar({
  name,
  color,
  size = 32,
  seed,
  status,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  seed?: string;
  status?: DotState;
  className?: string;
}) {
  if (!status) return <PixelPortrait seed={seed ?? name} color={color} size={size} title={name} className={className} />;
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <PixelPortrait seed={seed ?? name} color={color} size={size} title={name} />
      <StatusDot state={status} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background" />
    </span>
  );
}

/** Model-written text, rendered as markdown. */
export function Prose({ children, className }: { children: string; className?: string }) {
  return <Markdown className={className}>{children}</Markdown>;
}

/**
 * Empty state for every list: icon in a 56px muted tile, title 14/20 600, body 13 muted,
 * one action (an `outline sm` Button or a Link styled as one). `compact` for side panels.
 *   <EmptyState icon={<Inbox />} title="Nothing waiting on you" body="…" action={…} />
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "py-8" : "py-16", className)}>
      {icon && (
        <div
          aria-hidden
          className={cn(
            "mb-4 flex items-center justify-center rounded-xl bg-muted text-placeholder [&_svg]:size-8 [&_svg]:stroke-[1.5]",
            compact ? "size-11 [&_svg]:size-6" : "size-14",
          )}
        >
          {icon}
        </div>
      )}
      <p className="text-sm leading-5 font-semibold text-foreground">{title}</p>
      {body && <p className="mt-1 max-w-[44ch] text-[13px] leading-[18px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** The 10×10 pixel briefcase logo (brand), drawn with rects so it stays crisp. */
export function PixelLogo({ size = 22, className }: { size?: number; className?: string }) {
  const px = [
    "...####...",
    "...#..#...",
    "##########",
    "#oooooooo#",
    "#oooooooo#",
    "####gg####",
    "#oooooooo#",
    "#oooooooo#",
    "#oooooooo#",
    "##########",
  ];
  const fill: Record<string, string> = { "#": "#2a1d22", o: "#f4b942", g: "#fff3c4" };
  return (
    <svg viewBox="0 0 10 10" width={size} height={size} shapeRendering="crispEdges" aria-hidden className={className}>
      {px.flatMap((row, y) =>
        [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill[c]} />)),
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ layout */

const PAGE_W = {
  default: "max-w-[var(--content-w)]",
  wide: "max-w-[var(--content-w-wide)]",
  full: "max-w-[1480px]",
  /** Documents: 860px, or the whole page in full-width mode (src/components/doc-layout.tsx). */
  doc: "max-w-[var(--doc-w)]",
} as const;

/**
 * The page column under the top bar: centered, 708px (default, reading pages), 1100px
 * (wide, tables/databases), 860px or the whole page (doc: documents, see
 * src/components/doc-layout.tsx) or full width; 48px side padding on desktop, 16px on a phone,
 * 40px of air on top. Chat and editor routes that fill the viewport skip it.
 * (Pages that don't render a PageBody yet get the old padded frame from the layout.)
 */
export function PageBody({
  width = "default",
  className,
  children,
}: {
  width?: keyof typeof PAGE_W;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-page-body={width} className={cn("mx-auto w-full px-4 pt-8 pb-24 sm:px-12 sm:pt-10", PAGE_W[width], className)}>
      {children}
    </div>
  );
}

export type Property = { label: ReactNode; value: ReactNode; icon?: ReactNode };

/** Notion-style property rows: 140px label column (13px tertiary, optional 16px icon), 13px value. */
export function PropertyList({ items, className }: { items: Property[]; className?: string }) {
  if (!items.length) return null;
  return (
    <dl className={cn("grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-2 text-[13px] leading-[18px]", className)}>
      {items.map((p, i) => (
        <div key={i} className="contents">
          <dt className="flex min-h-8 items-center gap-1.5 text-tertiary [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]">
            {p.icon}
            <span className="truncate">{p.label}</span>
          </dt>
          <dd className="flex min-h-8 min-w-0 items-center text-foreground">{p.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Page title block: optional 28px icon (lucide element or emoji), title 28/34 700,
 * one-line description (muted, max 60ch), Notion property rows, actions on the right
 * (use `size="sm"` buttons). 32px below. `subtitle` is the old name of `description`.
 */
export function PageHeader({
  icon,
  title,
  description,
  subtitle,
  properties,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** @deprecated use `description` */
  subtitle?: ReactNode;
  properties?: Property[];
  actions?: ReactNode;
  className?: string;
}) {
  const desc = description ?? subtitle;
  return (
    <header className={cn("mb-8", className)}>
      {icon && (
        <div aria-hidden className="mb-3 flex size-9 items-center text-[28px] leading-none text-foreground [&_svg]:size-7 [&_svg]:stroke-[1.5]">
          {icon}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-[min(100%,16rem)] flex-1">
          <h1 className="text-[28px] leading-[34px] font-bold tracking-tight text-foreground [overflow-wrap:anywhere]">{title}</h1>
          {desc && <p className="mt-1.5 max-w-[60ch] text-sm leading-[22px] text-muted-foreground">{desc}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div>}
      </div>
      {properties && properties.length > 0 && <PropertyList items={properties} className="mt-4" />}
    </header>
  );
}

/** A page section: 16/24 600 heading with optional right-side actions, 32px apart. No box. */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold tracking-[-0.005em] text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export type LineTab = { href: string; label: ReactNode; active: boolean; count?: number; icon?: ReactNode };

/**
 * URL-driven line tabs (views): 32px, 13/18 500, ink + 2px underline when active.
 *   <LineTabs items={[{ href: "?view=all", label: "All", active: view === "all", count: 12 }]} />
 * `trailing` renders at the right end of the tab row (filters, search).
 */
export function LineTabs({ items, trailing, className, label }: { items: LineTab[]; trailing?: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn("flex min-h-8 items-end gap-3 border-b border-border", className)}>
      <nav aria-label={label} className="-mb-px flex min-w-0 flex-1 items-end gap-4 overflow-x-auto [scrollbar-width:none]">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            scroll={false}
            aria-current={it.active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm text-[13px] leading-[18px] font-medium whitespace-nowrap transition-colors duration-100 [&_svg]:size-4 [&_svg]:stroke-[1.75]",
              "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:transition-opacity after:duration-150",
              it.active ? "text-foreground after:opacity-100" : "text-muted-foreground after:opacity-0 hover:text-foreground",
            )}
          >
            {it.icon}
            {it.label}
            {it.count !== undefined && <span className="text-xs font-normal text-tertiary tabular-nums">{it.count}</span>}
          </Link>
        ))}
      </nav>
      {trailing && <div className="flex shrink-0 items-center gap-2 pb-1">{trailing}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ skeletons */

/** Title + description + a 6-row list. The default `<Suspense fallback>` for a page. */
export function PageSkeleton() {
  return (
    <PageBody>
      <Skeleton className="h-[34px] w-56 rounded-md" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <ListSkeleton rows={6} className="mt-10" />
    </PageBody>
  );
}

/** Rows with an avatar, a title and a meta line (44px each). */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-1", className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5" style={{ width: `${55 - ((i * 7) % 25)}%` }} />
            <Skeleton className="h-3" style={{ width: `${30 - ((i * 5) % 12)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A DataTable placeholder: 34px header + rows. */
export function TableSkeleton({ rows = 8, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("w-full", className)} aria-busy>
      <div className="flex h-[34px] items-center gap-6 border-b border-border">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className="h-3" style={{ width: c === 0 ? "28%" : "12%" }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-[34px] items-center gap-6 border-b border-border/70">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-3.5" style={{ width: c === 0 ? `${22 + ((r * 7) % 14)}%` : `${8 + ((r + c) % 3) * 3}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A chat thread placeholder: alternating agent turns and a user bubble, composer below. */
export function ChatSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col", className)} aria-busy>
      <div className="flex-1 space-y-6 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-6">
            <div className="grid grid-cols-[28px_1fr] gap-3">
              <Skeleton className="size-7 rounded-md" />
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-[85%]" />
                <Skeleton className="h-3.5 w-[60%]" />
              </div>
            </div>
            {i < 2 && <Skeleton className="ml-auto h-9 w-[40%] rounded-lg" />}
          </div>
        ))}
      </div>
      <Skeleton className="h-[76px] w-full rounded-lg" />
    </div>
  );
}

/** A document placeholder: title + properties + paragraphs (708px column). */
export function EditorSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[var(--content-w)]", className)} aria-busy>
      <Skeleton className="h-12 w-2/3 rounded-md" />
      <div className="mt-6 space-y-2.5">
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="mt-8 space-y-3 border-t border-border pt-8">
        {[92, 100, 84, 96, 60].map((w, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

/** A gallery placeholder (Files, Library): 4:3 tiles with a caption. */
export function CardGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4", className)} aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}
