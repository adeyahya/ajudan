import * as React from "react"
import { cn } from "cn"

/**
 * Text input (UI-PLAN §2.5): 32px (`inputSize="sm"` → 28px / 13px), 6px radius, hairline
 * border that darkens on hover, blue border + 2px soft ring on focus.
 */
function Input({
  className,
  type,
  inputSize = "default",
  ...props
}: React.ComponentProps<"input"> & { inputSize?: "default" | "sm" }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={inputSize}
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-base text-foreground transition-[border-color,box-shadow] duration-100 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-placeholder hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-[size=sm]:h-7 data-[size=sm]:px-2 data-[size=sm]:text-[13px] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
