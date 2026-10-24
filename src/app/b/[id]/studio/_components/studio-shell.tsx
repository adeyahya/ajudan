"use client";

import { AudioLines, Clapperboard, Info } from "lucide-react";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useT } from "@/components/i18n";
import { IconButton, LineTabs, PageBody, PageHeader } from "@/components/kit";
import { SidePeekLayout } from "@/components/side-peek";

/**
 * The Studio's page frame: the "Studio" title (with the no-Claude-usage note as a tooltip),
 * line tabs for the video and audio editors, and the page below. Docs, Library and
 * Contacts have their own routes now; shared controls live in src/components/workspace-ui.tsx.
 */
export function StudioShell({ peek, children }: { peek?: ReactNode; children: ReactNode }) {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const base = `/b/${id}/studio`;
  const tabs = [
    { href: "/video", label: t("studio.tab.video"), icon: <Clapperboard /> },
    { href: "/audio", label: t("studio.tab.audio"), icon: <AudioLines /> },
  ];
  const body = (
    <PageBody width="full">
      {/* Focus mode (src/components/doc-layout.tsx) hides the Studio's title and tabs. */}
      <div data-focus-hide>
        <PageHeader
          className="mb-5"
          title={
            <span className="inline-flex items-center gap-1.5">
              {t("nav.studio")}
              <IconButton label={t("studio.noUsage")} side="right" className="size-6">
                <Info />
              </IconButton>
            </span>
          }
        />
        <LineTabs
          label={t("nav.studio")}
          items={tabs.map((tab) => {
            const href = base + tab.href;
            return { href, label: tab.label, icon: tab.icon, active: pathname.startsWith(href) };
          })}
        />
      </div>
      <div className="@container mt-6">{children}</div>
    </PageBody>
  );
  return peek ? <SidePeekLayout peek={peek}>{body}</SidePeekLayout> : body;
}
