import { connection } from "next/server";
import { Badge, Button, Label, Textarea } from "@/components/kit";
import { listSecrets } from "@/lib/secrets";
import { deleteSecretAction, saveNetworkDomains, saveSecretAction } from "./actions";
import { SecretForm } from "./secret-form";

/**
 * Credentials the team may use for APIs (values in the macOS Keychain, never shown
 * again) and the domains the teammates' sandboxed shell may reach.
 */
export async function SecretsPanel({ businessId, domains, shellMates }: { businessId: string; domains: string[]; shellMates: string[] }) {
  await connection();
  const secrets = listSecrets(businessId);
  return (
    <div className="grid gap-4">
      <h2 className="text-lg text-primary">API keys &amp; access</h2>
      <p className="text-xs text-muted-foreground">
        API keys and tokens your teammates may use, for example a read-only key to your shop&apos;s data. The value is kept in this
        Mac&apos;s Keychain: teammates only refer to it by name, it&apos;s only sent to the hosts you list, and it&apos;s hidden in
        everything they see. Never paste keys into a chat; teammates ask for them on the Approvals page.
      </p>
      {secrets.length > 0 && (
        <ul className="grid gap-2 text-sm">
          {secrets.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
              <code className="font-mono text-xs">{`{{secret.${s.name}}}`}</code>
              <span className="text-xs text-muted-foreground">→ {s.hosts.join(", ")}</span>
              {s.lastUsedAt && <Badge>used {s.lastUsedAt.toLocaleDateString()}</Badge>}
              {s.note && <span className="w-full text-xs text-muted-foreground">{s.note}</span>}
              <form action={deleteSecretAction.bind(null, businessId, s.name)} className="ml-auto">
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <SecretForm action={saveSecretAction.bind(null, businessId)} />

      <form action={saveNetworkDomains.bind(null, businessId)} className="grid gap-2 border-t border-border pt-4">
        <Label htmlFor="domains">Domains teammates&apos; shell may reach (one per line)</Label>
        <p className="text-xs text-muted-foreground">
          For teammates with &ldquo;Can run commands&rdquo; ({shellMates.length ? shellMates.join(", ") : "nobody yet"}). Their shell
          is sandboxed: it only writes in their own folder and can&apos;t read your other files.
        </p>
        <Textarea id="domains" name="domains" rows={3} defaultValue={domains.join("\n")} placeholder={"orucraft.com\napi.example.com"} />
        <div>
          <Button type="submit" variant="secondary">
            Save domains
          </Button>
        </div>
      </form>
    </div>
  );
}
