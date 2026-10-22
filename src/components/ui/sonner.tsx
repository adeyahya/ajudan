"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Toasts (UI-PLAN §2.5): bottom-left, 12px radius, menu shadow, 13px, 4s, 16px icons.
 * Mounted once by the business shell (src/app/b/[id]/layout.tsx); call `toast()` /
 * `toast.success()` / `toast.error()` from "sonner" anywhere below it.
 * Rule: toast for every mutation that changes a list on screen; inline "Saved" for autosave.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-left"
      // Phone: clear the 56px bottom bar (and the home indicator).
      mobileOffset={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
      duration={4000}
      gap={8}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin text-tertiary" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          description: "text-muted-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
