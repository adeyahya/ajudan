import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Loader2Icon } from "lucide-react"
import { Slot } from "radix-ui"

/**
 * Notion-style buttons (UI-PLAN §2.5). Radius 6px, no press-translate.
 * Sizes: sm 28px (toolbars, rows, cards), default 32px, lg 36px (onboarding/home CTAs only),
 * icon-sm 28, icon 32. `xs`/`icon-xs`/`icon-lg` stay for older callers.
 * Variants: default (primary blue), outline (Notion "secondary"), ghost, subtle (grey fill),
 * destructive (red text), link. `secondary` is kept as an alias of `subtle`.
 * `loading` swaps the leading icon for a spinner and sets aria-busy.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity] duration-100 ease-(--ease) outline-none select-none motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-busy:opacity-70 aria-busy:[&>svg:not([data-spinner])]:hidden aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border-border bg-background text-foreground hover:bg-hover aria-expanded:bg-hover",
        secondary:
          "bg-secondary text-foreground hover:bg-hover-strong aria-expanded:bg-hover-strong",
        subtle:
          "bg-secondary text-foreground hover:bg-hover-strong aria-expanded:bg-hover-strong",
        ghost:
          "text-foreground hover:bg-hover aria-expanded:bg-hover",
        destructive:
          "text-destructive hover:bg-destructive/8 focus-visible:outline-destructive",
        link: "h-auto! px-0! text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-4",
        icon: "size-8",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner in place of the leading icon and marks the button busy. */
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <Loader2Icon data-spinner className="animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
