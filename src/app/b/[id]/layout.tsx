import { Suspense } from "react";
import { BusinessNav } from "./nav";

// Not async: params are read on the client by BusinessNav, so the shell can prerender.
export default function BusinessLayout({ children }: LayoutProps<"/b/[id]">) {
  return (
    <div className="flex-1 flex flex-col">
      <Suspense fallback={<div className="h-[41px] border-b border-border" />}>
        <BusinessNav />
      </Suspense>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}
