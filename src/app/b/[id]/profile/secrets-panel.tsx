import { connection } from "next/server";
import { Badge, Button, Label, Textarea } from "@/components/kit";
import { dateLocale, t, type UiLang } from "@/lib/i18n";
import { listSecrets } from "@/lib/secrets";
import { deleteSecretAction, saveNetworkDomains, saveSecretAction } from "./actions";
import { SecretForm } from "./secret-form";

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
    <div className="grid gap-4">
      <h2 className="text-lg text-primary">{t(lang, "profile.secrets.title")}</h2>
      <p className="text-xs text-muted-foreground">{t(lang, "profile.secrets.help")}</p>
      {secrets.length > 0 && (
        <ul className="grid gap-2 text-sm">
          {secrets.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
              <code className="font-mono text-xs">{`{{secret.${s.name}}}`}</code>
              <span className="text-xs text-muted-foreground">→ {s.hosts.join(", ")}</span>
              {s.lastUsedAt && <Badge>{t(lang, "profile.secrets.used", { date: s.lastUsedAt.toLocaleDateString(dateLocale(lang)) })}</Badge>}
              {s.note && <span className="w-full text-xs text-muted-foreground">{s.note}</span>}
              <form action={deleteSecretAction.bind(null, businessId, s.name)} className="ml-auto">
                <Button type="submit" variant="ghost" size="sm">
                  {t(lang, "common.remove")}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <SecretForm action={saveSecretAction.bind(null, businessId)} />

      <form action={saveNetworkDomains.bind(null, businessId)} className="grid gap-2 border-t border-border pt-4">
        <Label htmlFor="domains">{t(lang, "profile.secrets.domains")}</Label>
        <p className="text-xs text-muted-foreground">
          {t(lang, "profile.secrets.domainsHelp", { names: shellMates.length ? shellMates.join(", ") : t(lang, "profile.secrets.nobodyYet") })}
        </p>
        <Textarea id="domains" name="domains" rows={3} defaultValue={domains.join("\n")} placeholder={"orucraft.com\napi.example.com"} />
        <div>
          <Button type="submit" variant="secondary">
            {t(lang, "profile.secrets.saveDomains")}
          </Button>
        </div>
      </form>
    </div>
  );
}
