import { Globe } from "lucide-react";
import { connection } from "next/server";
import { Badge, Field, Input, Section, Textarea } from "@/components/kit";
import { browserStatus, SUGGESTED_SITES } from "@/lib/browser";
import { t, tn, type UiLang } from "@/lib/i18n";
import { ActionForm, SubmitButton } from "../team/action-form";
import { closeBusinessBrowser, openBusinessBrowser, saveBrowserSites } from "./actions";

/**
 * The business's own Chrome profile. The owner opens it to log in to seller accounts;
 * teammates with browser access drive the same logged-in browser.
 */
export async function BrowserPanel({
  businessId,
  sites,
  teammatesWithAccess,
  lang,
}: {
  businessId: string;
  sites: string[];
  teammatesWithAccess: string[];
  lang: UiLang;
}) {
  await connection();
  const status = await browserStatus();

  return (
    <div>
      <Section
        title={t(lang, "profile.browser.title")}
        description={t(lang, "profile.browser.help")}
        actions={<Badge tone={status.running ? "green" : "gray"}>{t(lang, status.running ? "profile.browser.open" : "profile.browser.closed")}</Badge>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm
            action={openBusinessBrowser.bind(null, businessId)}
            success={t(lang, "profile.toast.browserOpened")}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          >
            <div className="relative min-w-56 flex-1">
              <Globe className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-tertiary" />
              <Input name="url" aria-label={t(lang, "profile.browser.url")} placeholder="https://seller.shopee.co.id" className="pl-8" />
            </div>
            <SubmitButton size="sm">{t(lang, status.running ? "profile.browser.openPage" : "profile.browser.openBrowser")}</SubmitButton>
          </ActionForm>
          {status.running && (
            <ActionForm action={closeBusinessBrowser.bind(null, businessId)} success={t(lang, "profile.toast.browserClosed")}>
              <SubmitButton size="sm" variant="secondary">
                {t(lang, "common.close")}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </Section>

      <Section title={t(lang, "profile.browser.sitesTitle")}>
        <ActionForm action={saveBrowserSites.bind(null, businessId)} success={t(lang, "profile.toast.sites")} className="grid gap-3">
          <Field
            label={t(lang, "profile.browser.sites")}
            htmlFor="sites"
            hint={`${sites.length ? tn(lang, "profile.browser.sitesAllowed", sites.length) : t(lang, "profile.browser.sitesEmpty")} ${t(lang, "profile.browser.suggestions", { sites: SUGGESTED_SITES.join(", ") })}`}
          >
            <Textarea id="sites" name="sites" rows={5} defaultValue={sites.join("\n")} placeholder={SUGGESTED_SITES.slice(0, 4).join("\n")} className="font-mono text-[13px]" />
          </Field>
          <div>
            <SubmitButton size="sm" variant="secondary">
              {t(lang, "profile.browser.saveSites")}
            </SubmitButton>
          </div>
        </ActionForm>
        <p className="mt-4 text-xs text-tertiary">
          {teammatesWithAccess.length ? t(lang, "profile.browser.canUse", { names: teammatesWithAccess.join(", ") }) : t(lang, "profile.browser.nobody")}
        </p>
      </Section>
    </div>
  );
}
