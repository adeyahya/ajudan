"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The business top bar's page-provided parts (src/app/b/[id]/top-bar.tsx):
 *
 * 1. Breadcrumbs. The top bar always shows `Business › Section` (from the route); a page
 *    adds its own trailing crumbs:
 *      client:  useBreadcrumb([{ label: page.title }])               (re-run when they change)
 *      server:  <SetBreadcrumb items={[{ label: "work", href: "?path=work" }, { label: "images" }]} />
 *    The last crumb is the current page (no href needed). Cleared when the page unmounts.
 *
 * 2. Actions. Buttons on the right of the top bar ("Suggestions", view switch, "…" menu):
 *      <TopBarActions><Button size="sm" variant="ghost">…</Button></TopBarActions>
 *    Children are portaled into the bar; keep them `sm` (28px) and few.
 *
 * Both work only under the business layout (BreadcrumbProvider is mounted there).
 */

export type Crumb = { label: string; href?: string };

type Ctx = {
  crumbs: Crumb[];
  setCrumbs: (c: Crumb[]) => void;
  actionsEl: HTMLElement | null;
  setActionsEl: (el: HTMLElement | null) => void;
};

const BreadcrumbContext = createContext<Ctx | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  return (
    <BreadcrumbContext.Provider value={{ crumbs, setCrumbs, actionsEl, setActionsEl }}>{children}</BreadcrumbContext.Provider>
  );
}

/** Page-provided crumbs, for the top bar. */
export function usePageCrumbs() {
  return useContext(BreadcrumbContext)?.crumbs ?? [];
}

/** The top bar registers its actions slot here. */
export function useActionsSlot() {
  return useContext(BreadcrumbContext)?.setActionsEl;
}

/** Set the trailing breadcrumbs for the current page (client components). */
export function useBreadcrumb(items: Crumb[]) {
  const ctx = useContext(BreadcrumbContext);
  const key = JSON.stringify(items);
  const set = ctx?.setCrumbs;
  useEffect(() => {
    if (!set) return;
    set(JSON.parse(key) as Crumb[]);
    return () => set([]);
  }, [key, set]);
}

/** Server-page form of useBreadcrumb: render it anywhere in the page. */
export function SetBreadcrumb({ items }: { items: Crumb[] }) {
  useBreadcrumb(items);
  return null;
}

/** Put buttons on the right side of the top bar (portaled). */
export function TopBarActions({ children }: { children: ReactNode }) {
  const el = useContext(BreadcrumbContext)?.actionsEl;
  return el ? createPortal(children, el) : null;
}
