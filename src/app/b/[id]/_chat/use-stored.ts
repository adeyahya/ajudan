"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A per-viewer preference in localStorage (a convenience only: private windows and
 * blocked storage fall back to `fallback`). The server snapshot is `serverFallback`
 * (default `fallback`), so hydration matches and the stored value applies right after.
 */
const EVENT = "ajudan:stored";
/** Where a choice lives for this page view when storage is blocked. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useStored(key: string, fallback: string, serverFallback = fallback): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => serverFallback,
  );
  const set = useCallback(
    (v: string) => {
      memory.set(key, v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        // Storage blocked: the choice lasts for this page view.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
