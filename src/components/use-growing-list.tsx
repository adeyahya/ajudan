"use client";

import { useEffect, useState } from "react";

/**
 * Render a long list a slice at a time: the first `step` items, then `step` more each
 * time the returned `sentinel` (put it right after the list) scrolls near the screen.
 * Filtering stays on the whole list; a new `resetKey` (the filters) starts over.
 */
export function useGrowingList<T>(items: T[], resetKey: string, step = 120) {
  const [state, setState] = useState({ key: resetKey, count: step });
  const count = state.key === resetKey ? state.count : step;
  // A callback ref: the observer attaches whenever the sentinel mounts, even after the effect first ran.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const more = count < items.length;
  useEffect(() => {
    if (!el || !more) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setState({ key: resetKey, count: count + step });
    }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el, more, count, resetKey, step]);
  return { visible: more ? items.slice(0, count) : items, sentinel: more ? <div ref={setEl} aria-hidden className="h-px" /> : null };
}
