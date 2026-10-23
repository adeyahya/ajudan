"use client";

import { FoldHorizontal, Maximize2, Minimize2, UnfoldHorizontal } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n";
import { cn, IconButton } from "@/components/kit";
import { useShortcut } from "@/components/shortcuts";

/**
 * How much room a document gets (Context pages, Studio docs, markdown in Files).
 *
 * Full width: the doc column (`--doc-w`, 860px) grows to the whole page, remembered on
 * this device (localStorage `ajudan:doc:wide`, restored before paint by the root layout's
 * script as <html data-doc-wide>). Focus: hides the app sidebar and everything marked
 * `data-focus-hide` (the Context tree, the Studio's doc list and tabs) for this visit;
 * Esc or ⌘⇧F leaves it, and so does leaving the page. Both are CSS in globals.css.
 */

const WIDE_KEY = "ajudan:doc:wide";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const flag = (name: string) => () => document.documentElement.hasAttribute(name);
const setFlag = (name: string, on: boolean) => {
  document.documentElement.toggleAttribute(name, on);
  listeners.forEach((l) => l());
};

export function useDocLayout() {
  const wide = useSyncExternalStore(subscribe, flag("data-doc-wide"), () => false);
  const focus = useSyncExternalStore(subscribe, flag("data-doc-focus"), () => false);
  return {
    wide,
    focus,
    setWide: (on: boolean) => {
      setFlag("data-doc-wide", on);
      try {
        if (on) localStorage.setItem(WIDE_KEY, "1");
        else localStorage.removeItem(WIDE_KEY);
      } catch {}
    },
    setFocus: (on: boolean) => setFlag("data-doc-focus", on),
  };
}

/** The two top-bar buttons (full width, focus). Put one per doc page. */
export function DocLayoutButtons({ className }: { className?: string }) {
  const t = useT();
  const { wide, focus, setWide, setFocus } = useDocLayout();
  useShortcut("mod+shift+f", () => setFocus(!focus), { allowInInputs: true });
  useShortcut("escape", () => setFocus(false), { enabled: focus });
  // Leaving the page gives the chrome back.
  useEffect(() => () => setFlag("data-doc-focus", false), []);
  return (
    <span className={cn("hidden items-center lg:inline-flex", className)}>
      <IconButton label={wide ? t("doc.narrow") : t("doc.wide")} aria-pressed={wide} onClick={() => setWide(!wide)}>
        {wide ? <FoldHorizontal /> : <UnfoldHorizontal />}
      </IconButton>
      <IconButton label={focus ? t("doc.exitFocus") : t("doc.focus")} shortcut="⌘⇧F" aria-pressed={focus} onClick={() => setFocus(!focus)}>
        {focus ? <Minimize2 /> : <Maximize2 />}
      </IconButton>
    </span>
  );
}
