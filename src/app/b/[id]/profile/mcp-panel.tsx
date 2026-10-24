"use client";

import { Blocks, Trash2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { Badge, Button, EmptyState, Section } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { removeMcpServerAction, setMcpAccessAction, setMcpTrustedAction } from "./actions";

export type McpPanelServer = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  /** The command line or URL. */
  where: string;
  note: string;
  secrets: string[];
  trusted: boolean;
};

/**
 * Business → Tools: the MCP servers the owner approved (src/lib/mcp-servers.ts), usually
 * because a teammate asked for one. Who may use each, whether its tools run without
 * asking, and removing it.
 */
export function McpPanel({ businessId, servers, mates }: { businessId: string; servers: McpPanelServer[]; mates: { id: string; name: string; access: string[] }[] }) {
  const t = useT();
  const [, start] = useTransition();
  const [trusted, setTrusted] = useOptimistic(Object.fromEntries(servers.map((s) => [s.id, s.trusted])));
  const [access, setAccess] = useOptimistic(Object.fromEntries(mates.map((m) => [m.id, m.access])));

  if (!servers.length) {
    return (
      <Section title={t("profile.mcp.title")} description={t("profile.mcp.help")}>
        <EmptyState compact icon={<Blocks />} title={t("profile.mcp.emptyTitle")} body={t("profile.mcp.emptyBody")} />
      </Section>
    );
  }

  return (
    <Section title={t("profile.mcp.title")} description={t("profile.mcp.help")}>
      <ul className="space-y-4">
        {servers.map((s) => (
          <li key={s.id} className="rounded-lg border border-border">
            <div className="flex items-start gap-3 px-3 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">
                <Blocks />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium">{s.name}</span>
                  <Badge tone={s.transport === "stdio" ? "yellow" : undefined}>{t(s.transport === "stdio" ? "profile.mcp.local" : "profile.mcp.remote")}</Badge>
                  {s.secrets.map((n) => (
                    <Badge key={n}>{n}</Badge>
                  ))}
                </div>
                <code className="mt-1 block font-mono text-xs break-all text-tertiary">{s.where}</code>
                {s.note && <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{s.note}</p>}
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("profile.mcp.remove", { name: s.name })}
                title={t("profile.mcp.remove", { name: s.name })}
                onClick={() => {
                  if (!confirm(t("profile.mcp.removeConfirm", { name: s.name }))) return;
                  start(async () => {
                    await removeMcpServerAction(businessId, s.id);
                    toast(t("profile.mcp.removed", { name: s.name }));
                  });
                }}
              >
                <Trash2 />
              </Button>
            </div>
            <label className="flex cursor-pointer items-start gap-3 border-t border-border px-3 py-2.5 transition-colors duration-100 hover:bg-hover/50">
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-5 text-foreground">{t("profile.mcp.trusted")}</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">{t(trusted[s.id] ? "profile.mcp.trustedOn" : "profile.mcp.trustedOff")}</span>
              </span>
              <Switch
                className="mt-1"
                checked={trusted[s.id]}
                aria-label={t("profile.mcp.trusted")}
                onCheckedChange={(v) =>
                  start(async () => {
                    setTrusted({ ...trusted, [s.id]: v });
                    await setMcpTrustedAction(businessId, s.id, v);
                  })
                }
              />
            </label>
            <div className="border-t border-border px-3 py-2.5">
              <p className="mb-2 text-xs text-muted-foreground">{t("profile.mcp.who")}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {mates.map((m) => {
                  const on = access[m.id]?.includes(s.name) ?? false;
                  return (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch
                        checked={on}
                        aria-label={m.name}
                        onCheckedChange={(v) =>
                          start(async () => {
                            const cur = access[m.id] ?? [];
                            setAccess({ ...access, [m.id]: v ? [...cur, s.name] : cur.filter((n) => n !== s.name) });
                            try {
                              await setMcpAccessAction(businessId, m.id, s.name, v);
                            } catch (err) {
                              toast.error((err as Error).message);
                            }
                          })
                        }
                      />
                      {m.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
