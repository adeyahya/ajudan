import { connection } from "next/server";
import { Badge, Button, Label, Textarea } from "@/components/kit";
import { browserStatus, SUGGESTED_SITES } from "@/lib/browser";
import { t, tn, type UiLang } from "@/lib/i18n";
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
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg text-foreground">{t(lang, "profile.browser.title")}</h2>
        <Badge tone={status.running ? "green" : "neutral"}>{t(lang, status.running ? "profile.browser.open" : "profile.browser.closed")}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t(lang, "profile.browser.help")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <form action={openBusinessBrowser.bind(null, businessId)} className="flex flex-wrap items-center gap-2">
          <input
            name="url"
            placeholder="https://seller.shopee.co.id"
            className="pixel-select h-8 w-56 bg-transparent px-2 text-sm outline-none"
          />
          <Button type="submit">{t(lang, status.running ? "profile.browser.openPage" : "profile.browser.openBrowser")}</Button>
        </form>
        {status.running && (
          <form action={closeBusinessBrowser.bind(null, businessId)}>
            <Button type="submit" variant="secondary">
              {t(lang, "common.close")}
            </Button>
          </form>
        )}
      </div>

      <form action={saveBrowserSites.bind(null, businessId)} className="grid gap-2">
        <Label htmlFor="sites">{t(lang, "profile.browser.sites")}</Label>
        <Textarea
          id="sites"
          name="sites"
          rows={4}
          defaultValue={sites.join("\n")}
          placeholder={SUGGESTED_SITES.slice(0, 4).join("\n")}
        />
        <p className="text-xs text-muted-foreground">
          {sites.length ? tn(lang, "profile.browser.sitesAllowed", sites.length) : t(lang, "profile.browser.sitesEmpty")}{" "}
          {t(lang, "profile.browser.suggestions", { sites: SUGGESTED_SITES.join(", ") })}
        </p>
        <div>
          <Button type="submit" variant="secondary">
            {t(lang, "profile.browser.saveSites")}
          </Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        {teammatesWithAccess.length
          ? t(lang, "profile.browser.canUse", { names: teammatesWithAccess.join(", ") })
          : t(lang, "profile.browser.nobody")}
      </p>
    </div>
  );
}
