"use client";

import { BookOpen, Eye, Images, Users } from "lucide-react";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Section } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import type { EditArea } from "@/lib/team-edits";
import { setSupervisedAction, setTeamEditAction } from "./actions";

const ICONS: Record<EditArea, ReactNode> = { contacts: <Users />, context: <BookOpen />, library: <Images /> };

/**
 * Business → Team permissions: what the AI team may change by itself (src/lib/team-edits.ts),
 * one switch per area. Teammates can also ask for an area; approving it flips the switch here.
 * Above them, supervised mode (src/lib/supervision.ts) makes every change wait for the owner;
 * the switches below keep their settings and apply again when it's off.
 */
export function PermissionsPanel({ businessId, edits, supervised }: { businessId: string; edits: Record<EditArea, boolean>; supervised: boolean }) {
  const t = useT();
  const [, start] = useTransition();
  const [on, setOn] = useOptimistic(edits);
  const [watching, setWatching] = useOptimistic(supervised);
  const areas = Object.keys(edits) as EditArea[];
  return (
    <>
    <Section title={t("profile.supervised.title")}>
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3 transition-colors duration-100 hover:bg-hover/50">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">
          <Eye />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-5 font-medium text-foreground">{t("profile.supervised.label")}</span>
          <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">{t(watching ? "profile.supervised.on" : "profile.supervised.off")}</span>
        </span>
        <Switch
          className="mt-2"
          checked={watching}
          aria-label={t("profile.supervised.label")}
          onCheckedChange={(v) =>
            start(async () => {
              setWatching(v);
              await setSupervisedAction(businessId, v);
              toast(t(v ? "profile.supervised.toastOn" : "profile.supervised.toastOff"));
            })
          }
        />
      </label>
    </Section>
    <Section title={t("profile.perm.title")} description={t(watching ? "profile.perm.helpSupervised" : "profile.perm.help")}>
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
    </>
  );
}
