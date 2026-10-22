"use client";

import { Ellipsis, FolderOpen, Pencil, Play, UserRound } from "lucide-react";
import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { IconButton } from "@/components/kit";
import { SidePeek, useUrlPeek } from "@/components/side-peek";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * "About {name}" on a teammate's conversation: a side peek driven by `?about=1`, so the
 * header's avatar/name link, the "…" menu and a reload all open the same thing. Children
 * are the server-rendered profile.
 */
export function AboutPeek({ title, children }: { title: string; children: ReactNode }) {
  const peek = useUrlPeek("about");
  return (
    <SidePeek open={peek.value === "1"} onClose={peek.close} title={title}>
      {/* Marker: the page hides its conversation list while the peek is open on narrower desktops. */}
      <div data-about-peek>{children}</div>
    </SidePeek>
  );
}

/**
 * The conversation header's "…" menu: open the profile peek, the teammate's memory in
 * Files, run their scheduled work now (toast on start), edit them on Team.
 */
export function TeammateMenu({
  businessId,
  teammateId,
  profileHref,
  filesHref,
  teamHref,
  runNow,
}: {
  businessId: string;
  teammateId: string;
  profileHref: string;
  filesHref?: string;
  teamHref: string;
  runNow?: (fd: FormData) => Promise<void>;
}) {
  const t = useT();
  const [pending, start] = useTransition();
  const run = () => {
    if (!runNow) return;
    const fd = new FormData();
    fd.set("businessId", businessId);
    fd.set("teammateId", teammateId);
    start(async () => {
      try {
        await runNow(fd);
        toast(t("chathome.runStarted"));
      } catch {
        toast.error(t("chathome.runFailed"));
      }
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("chathome.more")}>
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={profileHref} scroll={false}>
            <UserRound />
            {t("chathome.openProfile")}
          </Link>
        </DropdownMenuItem>
        {filesHref && (
          <DropdownMenuItem asChild>
            <Link href={filesHref}>
              <FolderOpen />
              {t("chathome.openMemory")}
            </Link>
          </DropdownMenuItem>
        )}
        {runNow && (
          <DropdownMenuItem disabled={pending} onSelect={run}>
            <Play />
            {t("chathome.runNow")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={teamHref}>
            <Pencil />
            {t("chathome.editOnTeam")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
