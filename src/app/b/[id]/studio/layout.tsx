import { Suspense } from "react";
import { StudioNav } from "./studio-nav";

/**
 * The Studio: the owner's own workbench (library, docs, contacts, video and audio
 * editors). Nothing here calls Claude, so it all works while the team rests; what you
 * prepare here is what the team picks up next.
 */
export default function StudioLayout({ children }: LayoutProps<"/b/[id]/studio">) {
  return (
    <div className="space-y-5">
      <Suspense fallback={<div className="h-9" />}>
        <StudioNav />
      </Suspense>
      {children}
    </div>
  );
}
