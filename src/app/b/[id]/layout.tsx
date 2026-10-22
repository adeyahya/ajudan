import { Suspense } from "react";
import { getBusiness } from "@/lib/data";
import { BusinessNav } from "./nav";
import { WorkerBanner } from "./worker-banner";

// Not async: params are read on the client by BusinessNav, so the shell can prerender.
export default function BusinessLayout({ children, params }: LayoutProps<"/b/[id]">) {
  return (
    <div className="flex-1 flex flex-col">
      <Suspense fallback={<div className="h-[41px] border-b border-border" />}>
        <Nav params={params} />
      </Suspense>
      <Suspense fallback={null}>
        <WorkerBanner params={params} />
      </Suspense>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}

/** Once the team is hired the Interview tab steps back (the Business page still links to it). */
async function Nav({ params }: { params: LayoutProps<"/b/[id]">["params"] }) {
  const { id } = await params;
  const biz = await getBusiness(id);
  return <BusinessNav hideInterview={biz?.status === "active"} />;
}
