"use client";

import type { ReactNode } from "react";
import { appBridge } from "@/lib/app-bridge";

/** Desktop app: bring up the Businesses window (open another business next to this one). */
export function ShowBusinessesButton({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <button type="button" className={className} title={title} onClick={() => void appBridge()?.showHome()}>
      {children}
    </button>
  );
}
