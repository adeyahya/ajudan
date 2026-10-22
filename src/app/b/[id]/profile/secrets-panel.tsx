import { CalendarClock, Globe, KeyRound } from "lucide-react";
import { connection } from "next/server";
import { DataTable } from "@/components/data-table";
import { EmptyState, Field, Section, Textarea } from "@/components/kit";
import { dateLocale, t, type UiLang } from "@/lib/i18n";
import { listSecrets } from "@/lib/secrets";
import { ActionForm, SubmitButton } from "../team/action-form";
import { RemoveMenu } from "../team/team-client";
import { deleteSecretAction, saveNetworkDomains, saveSecretAction } from "./actions";
import { AddSecretDialog } from "./secret-form";

/**
 * Credentials the team may use for APIs (values in the macOS Keychain, never shown
 * again) and the domains the teammates' sandboxed shell may reach.
 */
export async function SecretsPanel({
  businessId,
  domains,
  shellMates,
  lang,
}: {
  businessId: string;
  domains: string[];
  shellMates: string[];
  lang: UiLang;
}) {
  await connection();
  const secrets = listSecrets(businessId);
  return (
    <div>
      <Section title={t(lang, "profile.secrets.title")} description={t(lang, "profile.secrets.help")} actions={<AddSecretDialog action={saveSecretAction.bind(null, businessId)} />}>
        <DataTable
          label={t(lang, "profile.secrets.title")}
          rows={secrets}
          getRowId={(s) => s.id}
          minWidth={560}
          empty={<EmptyState compact icon={<KeyRound />} title={t(lang, "profile.secrets.empty")} body={t(lang, "profile.secrets.emptyBody")} />}
          columns={[
            {
              key: "name",
              header: t(lang, "profile.secrets.name"),
              icon: <KeyRound />,
              title: (s) => s.note ?? `{{secret.${s.name}}}`,
              cell: (s) => (
                <span className="block min-w-0 py-1.5">
                  <code className="block truncate font-mono text-[13px]">{`{{secret.${s.name}}}`}</code>
                  {s.note && <span className="block truncate text-xs font-normal text-muted-foreground">{s.note}</span>}
                </span>
              ),
            },
            { key: "hosts", header: t(lang, "profile.secrets.hostsShort"), icon: <Globe />, width: 180, title: (s) => s.hosts.join(", "), cell: (s) => s.hosts.join(", ") },
            {
              key: "used",
              header: t(lang, "profile.secrets.lastUsed"),
              icon: <CalendarClock />,
              width: 120,
              cell: (s) => (s.lastUsedAt ? s.lastUsedAt.toLocaleDateString(dateLocale(lang)) : <span className="text-tertiary">{t(lang, "profile.secrets.never")}</span>),
            },
            {
              key: "actions",
              header: <span className="sr-only">{t(lang, "profile.secrets.actions")}</span>,
              width: 48,
              align: "right",
              cell: (s) => (
                <RemoveMenu
                  remove={deleteSecretAction.bind(null, businessId, s.name)}
                  itemLabel={t(lang, "common.remove")}
                  confirmTitle={t(lang, "profile.secrets.removeTitle", { name: s.name })}
                  confirmBody={t(lang, "profile.secrets.removeBody")}
                  confirmLabel={t(lang, "common.remove")}
                  success={t(lang, "profile.secrets.removed", { name: s.name })}
                />
              ),
            },
          ]}
        />
      </Section>

      <Section title={t(lang, "profile.secrets.domainsTitle")}>
        <ActionForm action={saveNetworkDomains.bind(null, businessId)} success={t(lang, "profile.toast.domains")} className="grid gap-3">
          <Field
            label={t(lang, "profile.secrets.domains")}
            htmlFor="domains"
            hint={t(lang, "profile.secrets.domainsHelp", { names: shellMates.length ? shellMates.join(", ") : t(lang, "profile.secrets.nobodyYet") })}
          >
            <Textarea id="domains" name="domains" rows={4} defaultValue={domains.join("\n")} placeholder={"orucraft.com\napi.example.com"} className="font-mono text-[13px]" />
          </Field>
          <div>
            <SubmitButton size="sm" variant="secondary">
              {t(lang, "profile.secrets.saveDomains")}
            </SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
