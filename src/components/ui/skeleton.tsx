import { cn } from "cn"

/** Loading placeholder: a muted block with a slow 1.5s pulse (see globals.css). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("rounded-sm bg-secondary", className)}
      {...props}
    />
  )
}

export { Skeleton }
