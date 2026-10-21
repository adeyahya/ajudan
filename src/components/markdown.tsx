"use client";

import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

/** Renders model-written markdown (agent replies, task results, deliverables). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      className={cn(
        "text-sm leading-relaxed [&_h1]:text-base [&_h2]:text-[15px] [&_h3]:text-sm [&_h1,&_h2,&_h3]:font-semibold [&_h1,&_h2,&_h3]:mt-4 [&_h1,&_h2,&_h3]:mb-1.5 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}
