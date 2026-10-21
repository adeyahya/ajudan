import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { CHROME_PATH } from "@/lib/browser";

/**
 * Turns HTML into PNG images with headless Chrome (your installed Chrome; nothing is
 * downloaded). Teammates design social posts and carousel slides as self-contained
 * HTML pages and render them here.
 */

let browser: Promise<Browser> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

function getBrowser() {
  browser ??= chromium.launch({ executablePath: CHROME_PATH, headless: true });
  clearTimeout(idle);
  // Close Chrome after a quiet minute; the next render starts it again.
  idle = setTimeout(() => {
    void browser?.then((b) => b.close());
    browser = undefined;
  }, 60_000);
  return browser;
}

export async function renderHtmlToPng(opts: { html: string; width: number; height: number; outPath: string }) {
  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(opts.html, { waitUntil: "networkidle", timeout: 30_000 });
    // Give web fonts a moment.
    await page.evaluate(() => document.fonts?.ready);
    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    await page.screenshot({ path: opts.outPath, type: "png", clip: { x: 0, y: 0, width: opts.width, height: opts.height } });
  } finally {
    await page.close();
  }
  return opts.outPath;
}
