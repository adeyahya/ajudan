import type { ComponentProps, ReactNode } from "react";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Label as ShadcnLabel } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
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

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card text-card-foreground", className)} {...props} />;
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
    neutral: "bg-muted text-foreground",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    red: "bg-red-500/15 text-red-700 dark:text-red-300",
    blue: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
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

/** Small round avatar with the teammate's initial and color. */
export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Model-written text, rendered as markdown. */
export function Prose({ children, className }: { children: string; className?: string }) {
  return <Markdown className={className}>{children}</Markdown>;
}
