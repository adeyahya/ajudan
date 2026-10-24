"use client";

import { BookOpen, Images, Users } from "lucide-react";
import { useOptimistic, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Section } from "@/components/kit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AccessLevel, AgentAccess, AgentCollection } from "@/lib/agent-access";
import { setAgentAccessAction } from "./actions";

// Mirrors AGENT_COLLECTIONS / ACCESS_LEVELS (src/lib/agent-access.ts reads the db, so it stays out of the client bundle).
const AGENT_COLLECTIONS: AgentCollection[] = ["docs", "library", "contacts"];
const ACCESS_LEVELS: AccessLevel[] = ["read", "suggest", "write"];
const ICONS: Record<AgentCollection, ReactNode> = { docs: <BookOpen />, library: <Images />, contacts: <Users /> };

/**
 * Business → Permissions → "What teammates can do": per workspace collection, Read only /
 * Suggest / Edit (businesses.agent_access, src/lib/agent-access.ts).
 */
export function AgentAccessPanel({ businessId, access }: { businessId: string; access: AgentAccess }) {
  const t = useT();
  const [, start] = useTransition();
  const [cur, setCur] = useOptimistic(access);
  return (
    <Section title={t("workspace.access.title")} description={t("workspace.access.help")}>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {AGENT_COLLECTIONS.map((c) => (
          <li key={c} className="flex items-start gap-3 px-3 py-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">{ICONS[c]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-5 font-medium text-foreground">{t(`workspace.access.${c}`)}</span>
              <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">{t(`workspace.access.${cur[c]}.help`)}</span>
            </span>
            <Select
              value={cur[c]}
              onValueChange={(v) =>
                start(async () => {
                  const level = v as AccessLevel;
                  setCur({ ...cur, [c]: level });
                  await setAgentAccessAction(businessId, c, level);
                  toast(t("workspace.access.saved", { area: t(`workspace.access.${c}`), level: t(`workspace.access.${level}`) }));
                })
              }
            >
              <SelectTrigger size="sm" className="mt-1 w-32" aria-label={t(`workspace.access.${c}`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`workspace.access.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
    </Section>
  );
}
