import { connection } from "next/server";
import { Badge, Button, Label, Textarea } from "@/components/kit";
import { browserStatus, SUGGESTED_SITES } from "@/lib/browser";
import { closeBusinessBrowser, openBusinessBrowser, saveBrowserSites } from "./actions";

/**
 * The business's own Chrome profile. The owner opens it to log in to seller accounts;
 * teammates with browser access drive the same logged-in browser.
 */
export async function BrowserPanel({
  businessId,
  sites,
  teammatesWithAccess,
}: {
  businessId: string;
  sites: string[];
  teammatesWithAccess: string[];
}) {
  await connection();
  const status = await browserStatus();

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg text-primary">Business browser</h2>
        <Badge tone={status.running ? "green" : "neutral"}>{status.running ? "Open" : "Closed"}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        A separate Chrome profile just for this business, on this laptop. Open it, log in to Shopee Seller Center, TikTok and
        the like once, and your teammates can work in those accounts. They never type passwords or codes, and they ask
        before changing anything (depending on each teammate&apos;s freedom setting).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <form action={openBusinessBrowser.bind(null, businessId)} className="flex flex-wrap items-center gap-2">
          <input
            name="url"
            placeholder="https://seller.shopee.co.id"
            className="pixel-select h-8 w-56 bg-transparent px-2 text-sm outline-none"
          />
          <Button type="submit">{status.running ? "Open page" : "Open browser"}</Button>
        </form>
        {status.running && (
          <form action={closeBusinessBrowser.bind(null, businessId)}>
            <Button type="submit" variant="secondary">
              Close
            </Button>
          </form>
        )}
      </div>

      <form action={saveBrowserSites.bind(null, businessId)} className="grid gap-2">
        <Label htmlFor="sites">Sites teammates may open (one per line, subdomains included)</Label>
        <Textarea
          id="sites"
          name="sites"
          rows={4}
          defaultValue={sites.join("\n")}
          placeholder={SUGGESTED_SITES.slice(0, 4).join("\n")}
        />
        <p className="text-xs text-muted-foreground">
          {sites.length
            ? `${sites.length} site${sites.length === 1 ? "" : "s"} allowed.`
            : "Empty: teammates can't open any site until you add one here or approve a teammate's request for it."}{" "}
          Suggestions:{" "}
          {SUGGESTED_SITES.join(", ")}.
        </p>
        <div>
          <Button type="submit" variant="secondary">
            Save sites
          </Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        {teammatesWithAccess.length
          ? `Can use it: ${teammatesWithAccess.join(", ")}.`
          : "No teammate can use it yet. Turn on “Can use the business browser” for a teammate on the Team page."}
      </p>
    </div>
  );
}
