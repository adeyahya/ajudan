import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.AJUDAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ajudan-urls-"));
const { isAllowedUrl } = await import("../worker/browser");

describe("isAllowedUrl", () => {
  const sites = ["shopee.co.id", "tiktok.com"];

  it("allows everything when the list is empty", () => {
    expect(isAllowedUrl("https://anything.example/x", [])).toBe(true);
    expect(isAllowedUrl("not a url", [])).toBe(true);
  });

  it("allows listed sites and their subdomains", () => {
    expect(isAllowedUrl("https://shopee.co.id/", sites)).toBe(true);
    expect(isAllowedUrl("https://seller.shopee.co.id/portal", sites)).toBe(true);
    expect(isAllowedUrl("https://www.tiktok.com/@x", sites)).toBe(true);
    expect(isAllowedUrl("HTTPS://SELLER.SHOPEE.CO.ID/", sites)).toBe(true);
  });

  it("refuses other hosts and lookalikes", () => {
    expect(isAllowedUrl("https://evil.com/", sites)).toBe(false);
    expect(isAllowedUrl("https://evilshopee.co.id/", sites)).toBe(false);
    expect(isAllowedUrl("https://shopee.co.id.evil.com/", sites)).toBe(false);
    expect(isAllowedUrl("https://shopee.com/", sites)).toBe(false);
  });

  it("strips www. from the host but not from the list", () => {
    expect(isAllowedUrl("https://www.shopee.co.id/", sites)).toBe(true);
    expect(isAllowedUrl("https://shopee.co.id/", ["www.shopee.co.id"])).toBe(false);
  });

  it("allows about: pages", () => {
    expect(isAllowedUrl("about:blank", sites)).toBe(true);
  });

  it("refuses unparseable URLs and schemes without a host", () => {
    expect(isAllowedUrl("", sites)).toBe(false);
    expect(isAllowedUrl("shopee.co.id", sites)).toBe(false); // no scheme
    expect(isAllowedUrl("javascript:alert(1)", sites)).toBe(false);
    expect(isAllowedUrl("file:///etc/passwd", sites)).toBe(false);
    expect(isAllowedUrl("data:text/html,hi", sites)).toBe(false);
  });
});
