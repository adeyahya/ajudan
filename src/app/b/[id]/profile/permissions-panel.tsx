"use client";

import { BookOpen, Images, Users } from "lucide-react";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Section } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import type { EditArea } from "@/lib/team-edits";
import { setTeamEditAction } from "./actions";

const ICONS: Record<EditArea, ReactNode> = { contacts: <Users />, context: <BookOpen />, library: <Images /> };

/**
 * Business → Team permissions: what the AI team may change by itself (src/lib/team-edits.ts),
 * one switch per area. Teammates can also ask for an area; approving it flips the switch here.
 */
export function PermissionsPanel({ businessId, edits }: { businessId: string; edits: Record<EditArea, boolean> }) {
  const t = useT();
  const [, start] = useTransition();
  const [on, setOn] = useOptimistic(edits);
  const areas = Object.keys(edits) as EditArea[];
  return (
    <Section title={t("profile.perm.title")} description={t("profile.perm.help")}>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {areas.map((a) => (
          <li key={a}>
            <label className="flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors duration-100 hover:bg-hover/50">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">{ICONS[a]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-5 font-medium text-foreground">{t(`profile.perm.${a}.title`)}</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">{t(on[a] ? `profile.perm.${a}.on` : `profile.perm.${a}.off`)}</span>
              </span>
              <Switch
                className="mt-2"
                checked={on[a]}
                aria-label={t(`profile.perm.${a}.title`)}
                onCheckedChange={(v) =>
                  start(async () => {
                    setOn({ ...on, [a]: v });
                    await setTeamEditAction(businessId, a, v);
                    toast(t(v ? "profile.perm.toastOn" : "profile.perm.toastOff", { area: t(`profile.perm.${a}.title`) }));
                  })
                }
              />
            </label>
          </li>
        ))}
      </ul>
    </Section>
  );
}
