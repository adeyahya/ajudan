import * as React from "react"
import { cn } from "cn"

/** Multi-line input: same look as Input, min 80px, grows with content, resizable vertically. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-base leading-[22px] text-foreground transition-[border-color,box-shadow] duration-100 outline-none placeholder:text-placeholder hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
