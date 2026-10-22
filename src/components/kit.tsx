import type { ComponentProps, ReactNode } from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label as ShadcnLabel } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { PixelPortrait } from "@/components/pixel-portrait";
import { cn } from "@/lib/utils";

/**
 * App-level building blocks on top of shadcn/ui (src/components/ui). Prefer shadcn
 * components directly for anything not here.
 */

export { cn, Skeleton };

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantMap = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
} as const;

export function Button({
  variant = "primary",
  size = "lg",
  ...props
}: Omit<ComponentProps<typeof ShadcnButton>, "variant"> & { variant?: ButtonVariant }) {
  return <ShadcnButton variant={variantMap[variant]} size={size} {...props} />;
}

/** A bordered panel. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("pixel-panel", className)} {...props} />;
}

export const Input = ShadcnInput;
export const Textarea = ShadcnTextarea;

export function Label({ className, ...props }: ComponentProps<typeof ShadcnLabel>) {
  return <ShadcnLabel className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "green" | "amber" | "red" | "blue" | "violet";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-[#f1f1ef] text-[#37352f]",
    green: "bg-[#dbeddb] text-[#1c3829]",
    amber: "bg-[#fdecc8] text-[#402c1b]",
    red: "bg-[#ffe2dd] text-[#5d1715]",
    blue: "bg-[#d3e5ef] text-[#183347]",
    violet: "bg-[#e8deee] text-[#412454]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-px text-xs font-medium leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Pixel portrait of a teammate (same chibi as in the office). Pass `seed` = teammate id. */
export function Avatar({ name, color, size = 32, seed }: { name: string; color: string; size?: number; seed?: string }) {
  return <PixelPortrait seed={seed ?? name} color={color} size={size} title={name} />;
}

/** Model-written text, rendered as markdown. */
export function Prose({ children, className }: { children: string; className?: string }) {
  return <Markdown className={className}>{children}</Markdown>;
}
