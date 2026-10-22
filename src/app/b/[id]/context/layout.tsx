import { Suspense } from "react";
import { ContextNav } from "./context-nav";

/**
 * The Context workspace (src/lib/context.ts): pages the team reads, the address book as
 * a database, and what each teammate actually reads. Nothing here calls Claude except
 * the inspector's test question, which the worker answers.
 */
export default function ContextLayout({ children }: LayoutProps<"/b/[id]/context">) {
  return (
    <div className="space-y-5">
      <Suspense fallback={<div className="h-9" />}>
        <ContextNav />
      </Suspense>
      {children}
    </div>
  );
}
