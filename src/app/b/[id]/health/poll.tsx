"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * A worker that stops writes no activity event, so LiveRefresh alone wouldn't show
 * it going down: refresh the page every `everyMs` as well.
 */
export function PollRefresh({ everyMs = 20_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
