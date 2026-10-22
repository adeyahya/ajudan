"use client";

import type { ReactNode } from "react";
import { SidePeek, useUrlPeek } from "@/components/side-peek";

/** The Inbox History's side peek (`?a=<approvalId>`); the body is server-rendered. */
export function HistoryPeek({ open, title, children }: { open: boolean; title?: string; children: ReactNode }) {
  const peek = useUrlPeek("a");
  return (
    <SidePeek open={open} onClose={peek.close} title={title}>
      {children}
    </SidePeek>
  );
}
