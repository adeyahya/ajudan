"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/kit";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * A disclosure for error text: a small chevron trigger, then the detail. `plain` renders
 * children as given (a list); otherwise they sit in a muted mono block.
 */
export function ErrorDetail({ label, plain, className, children }: { label: string; plain?: boolean; className?: string; children: ReactNode }) {
  return (
    <Collapsible className={cn("mt-1", className)}>
      <CollapsibleTrigger className="group -ml-1 inline-flex h-6 items-center gap-1 rounded-sm px-1 text-xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-hover hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {plain ? (
          <div className="mt-1">{children}</div>
        ) : (
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">{children}</pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
