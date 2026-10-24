"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/components/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import type { MessageKey } from "@/lib/i18n";

/**
 * Keyboard shortcuts (UI-PLAN §2.5).
 *
 * Page-level keys:
 *   useShortcut("j", () => move(1));                 // ignored while typing in a field
 *   useShortcut(["mod+shift+n"], newPage);           // mod = ⌘ on a Mac, Ctrl elsewhere
 *   useShortcut("escape", close, { allowInInputs: true });
 *
 * Global keys (mounted once by the business shell through useGlobalShortcuts):
 *   ⌘K search · ⌘\ sidebar · ⌘/ this list · g then c/o/i/w/k/t → Chat/Office/Inbox/Work/Konteks/Team, h/d/l/p → Home/Docs/Library/Contacts.
 */

/** True when the key event comes from a text field or rich-text editor. */
export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(type);
  }
  return tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const IS_MAC = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "mod+shift+k" → does this event match? Keys compare case-insensitively on `e.key`. */
export function matchesCombo(e: KeyboardEvent, combo: string) {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const want = { mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  const mod = IS_MAC() ? e.metaKey : e.ctrlKey;
  if (want.mod !== mod || want.alt !== e.altKey) return false;
  // Shift is implied by symbols like "?"; only enforce it when asked for.
  if (want.shift && !e.shiftKey) return false;
  if (!want.mod && !want.alt && (IS_MAC() ? e.ctrlKey : e.metaKey)) return false;
  const k = e.key.toLowerCase();
  return k === key || (key === "escape" && k === "esc") || (key === "\\" && e.code === "Backslash");
}

/**
 * Run `handler` on a key combo. Ignored while typing unless `allowInInputs` (combos with
 * mod are always allowed). Disabled when `enabled` is false.
 */
export function useShortcut(
  combo: string | string[],
  handler: (e: KeyboardEvent) => void,
  { enabled = true, allowInInputs = false }: { enabled?: boolean; allowInInputs?: boolean } = {},
) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const combos = (Array.isArray(combo) ? combo : [combo]).join("|");
  useEffect(() => {
    if (!enabled) return;
    const list = combos.split("|");
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      for (const c of list) {
        if (!matchesCombo(e, c)) continue;
        if (!allowInInputs && !c.includes("mod") && isTypingTarget(e.target)) return;
        e.preventDefault();
        ref.current(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combos, enabled, allowInInputs]);
}

/** g-then-letter navigation targets (Chat/Office/Inbox/Work/Konteks/Team, Home/Docs/Library/Contacts). */
export const GO_KEYS: { key: string; href: string; label: MessageKey }[] = [
  { key: "c", href: "", label: "nav.chat" },
  { key: "o", href: "/office", label: "nav.office" },
  { key: "i", href: "/approvals", label: "nav.inbox" },
  { key: "w", href: "/deliverables", label: "nav.work" },
  { key: "k", href: "/context", label: "nav.context" },
  { key: "t", href: "/team", label: "nav.team" },
  { key: "h", href: "/home", label: "nav.home" },
  { key: "d", href: "/docs", label: "nav.docs" },
  { key: "l", href: "/library", label: "nav.library" },
  { key: "p", href: "/contacts", label: "nav.contacts" },
];

/** The shell's global keys. `go` receives a GO_KEYS href (relative to /b/[id]). */
export function useGlobalShortcuts({
  onSearch,
  onToggleSidebar,
  onHelp,
  go,
}: {
  onSearch: () => void;
  onToggleSidebar: () => void;
  onHelp: () => void;
  go: (href: string) => void;
}) {
  useShortcut("mod+k", onSearch, { allowInInputs: true });
  useShortcut("mod+\\", onToggleSidebar, { allowInInputs: true });
  useShortcut("mod+/", onHelp, { allowInInputs: true });

  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      const k = e.key.toLowerCase();
      if (armed && Date.now() - armed < 1200) {
        armed = 0;
        const hit = GO_KEYS.find((g) => g.key === k);
        if (hit) {
          e.preventDefault();
          goRef.current(hit.href);
        }
        return;
      }
      if (k === "g" && !e.shiftKey) armed = Date.now();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const subscribeNoop = () => () => {};

/** "⌘" on a Mac, "Ctrl" elsewhere (⌘ during server render). */
export function useModKey() {
  return useSyncExternalStore(
    subscribeNoop,
    () => (IS_MAC() ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}

/** The ⌘/ dialog listing the global shortcuts. */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const mod = useModKey();
  const rows: { label: string; keys: string[] }[] = [
    { label: t("shortcuts.search"), keys: [mod, "K"] },
    { label: t("shortcuts.sidebar"), keys: [mod, "\\"] },
    { label: t("shortcuts.help"), keys: [mod, "/"] },
    { label: t("shortcuts.close"), keys: ["Esc"] },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          <ShortcutGroup title={t("shortcuts.everywhere")} rows={rows} />
          <ShortcutGroup
            title={t("shortcuts.goTo")}
            rows={GO_KEYS.map((g) => ({ label: t(g.label), keys: ["G", g.key.toUpperCase()] }))}
            then={t("shortcuts.then")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutGroup({ title, rows, then }: { title: string; rows: { label: string; keys: string[] }[]; then?: string }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-tertiary">{title}</h3>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.label} className="flex h-9 items-center justify-between gap-4 text-[13px] text-foreground">
            <span className="truncate">{r.label}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-tertiary">
              {r.keys.map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && then && <span>{then}</span>}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
