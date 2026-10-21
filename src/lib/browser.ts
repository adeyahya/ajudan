import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";

/**
 * Each business has its own Chrome profile on this laptop (data/browsers/<id>).
 * The owner logs into Shopee Seller Center, TikTok, etc. there once; teammates with
 * browser access drive the same, already-logged-in browser over CDP.
 */

export function browserProfileDir(businessId: string) {
  return path.join(DATA_DIR, "browsers", businessId);
}

/** Chrome writes its debugging port here when started with --remote-debugging-port=0. */
function readDevToolsPort(businessId: string): number | undefined {
  try {
    const first = fs.readFileSync(path.join(browserProfileDir(businessId), "DevToolsActivePort"), "utf8").split("\n")[0];
    const port = Number(first);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

export type BrowserStatus = { running: false } | { running: true; port: number; endpoint: string; version: string };

/** Is this business's browser open? Checks the CDP endpoint, not just the port file. */
export async function browserStatus(businessId: string): Promise<BrowserStatus> {
  const port = readDevToolsPort(businessId);
  if (!port) return { running: false };
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return { running: false };
    const info = (await res.json()) as { Browser?: string };
    return { running: true, port, endpoint, version: info.Browser ?? "Chrome" };
  } catch {
    return { running: false };
  }
}

const CHROME_PATH =
  process.env.AJUDAN_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Start this business's Chrome (visible window) if it isn't running. Returns its CDP endpoint. */
export async function ensureBrowser(businessId: string, businessName: string, url?: string) {
  const status = await browserStatus(businessId);
  if (status.running) return status.endpoint;
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}. Install Google Chrome or set AJUDAN_CHROME_PATH.`);
  }

  const dir = browserProfileDir(businessId);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, "DevToolsActivePort"), { force: true });
  // Detached so the browser (and your logins) survive worker restarts.
  const child = spawn(
    CHROME_PATH,
    [
      `--user-data-dir=${dir}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-name=Ajudan · ${businessName}`,
      url ?? "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const s = await browserStatus(businessId);
    if (s.running) return s.endpoint;
  }
  throw new Error("Chrome started but its debugging endpoint never came up.");
}

/** Close the business's Chrome via CDP (Browser.close). */
export async function closeBrowser(businessId: string) {
  const status = await browserStatus(businessId);
  if (!status.running) return;
  const res = await fetch(`${status.endpoint}/json/version`);
  const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl: string };
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    ws.onmessage = () => resolve();
    ws.onerror = () => resolve();
    setTimeout(resolve, 2000);
  });
}

/**
 * Normalize what the owner types ("https://seller.shopee.co.id/portal", "tiktok.com")
 * into bare hosts. Each host also allows its subdomains.
 */
export function normalizeSites(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    try {
      out.add(new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^www\./, ""));
    } catch {
      // ignore junk lines
    }
  }
  return [...out];
}

/** Quick picks shown in the settings UI. */
export const SUGGESTED_SITES = [
  "seller.shopee.co.id",
  "shopee.co.id",
  "seller-id.tokopedia.com",
  "tiktok.com",
  "seller-id.tiktok.com",
  "business.facebook.com",
  "instagram.com",
  "web.whatsapp.com",
];
