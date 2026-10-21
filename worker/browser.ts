/**
 * The business browser, worker side: serializes access (one teammate drives it at a
 * time) and describes the MCP server that gives a teammate browser tools. Launching
 * and closing Chrome live in src/lib/browser.ts (the web app uses them too).
 *
 * The provider is swappable: today it's Playwright MCP attached over CDP. Another
 * provider (Chrome DevTools MCP, agent-browser…) only needs to implement BrowserProvider.
 */
import { createRequire } from "node:module";
import path from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
export { closeBrowser, ensureBrowser } from "@/lib/browser";

// ---- one driver at a time per business ----

const locks = new Map<string, Promise<void>>();

/**
 * Run `fn` while holding the business's browser. Two teammates clicking in the same
 * window would fight over tabs, so browser tasks for a business queue up here.
 */
export async function withBrowserLock<T>(businessId: string, onWait: () => void, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(businessId);
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chain = (prev ?? Promise.resolve()).then(() => mine);
  locks.set(businessId, chain);
  if (prev) {
    onWait();
    await prev;
  }
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(businessId) === chain) locks.delete(businessId);
  }
}

// ---- provider ----

export type BrowserProvider = {
  /** MCP server name; tools appear as mcp__<server>__<tool>. */
  server: string;
  config(opts: { cdpEndpoint: string; outputDir: string }): McpServerConfig;
  /** The URL a tool call would open, if any (checked against the business's site list). */
  targetUrl(tool: string, input: Record<string, unknown>): string | undefined;
  /** Tools that only look (always allowed when browser access is on). */
  lookTools: string[];
  /** Tools that interact with the page (allowed; committing changes needs approval, see prompt). */
  actTools: string[];
  /** Tools a teammate never gets. */
  blockedTools: string[];
};

const require_ = createRequire(import.meta.url);

export const playwrightProvider: BrowserProvider = {
  server: "browser",
  // Not using --allowed-origins: it filters every request (CDNs, images), which breaks
  // marketplace pages. Ajudan checks navigation targets in canUseTool instead.
  config({ cdpEndpoint, outputDir }) {
    const cli = path.join(path.dirname(require_.resolve("@playwright/mcp/package.json")), "cli.js");
    const args = [cli, "--cdp-endpoint", cdpEndpoint, "--output-dir", outputDir];
    return { type: "stdio", command: process.execPath, args };
  },
  targetUrl(tool, input) {
    if (tool.endsWith("__browser_navigate") && typeof input.url === "string") return input.url;
    if (tool.endsWith("__browser_tabs") && typeof input.url === "string") return input.url;
    return undefined;
  },
  lookTools: [
    "browser_navigate",
    "browser_navigate_back",
    "browser_snapshot",
    "browser_take_screenshot",
    "browser_wait_for",
    "browser_tabs",
    "browser_find",
    "browser_console_messages",
    "browser_network_requests",
    "browser_resize",
    "browser_hover",
  ],
  actTools: [
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_select_option",
    "browser_press_key",
    "browser_drag",
    "browser_drop",
    "browser_handle_dialog",
  ],
  blockedTools: [
    "browser_run_code_unsafe",
    "browser_evaluate",
    "browser_file_upload",
    "browser_close",
    "browser_install",
  ],
};

export const browserProvider: BrowserProvider = playwrightProvider;

/** May a teammate open this URL? Empty site list = anything. Subdomains of a listed host count. */
export function isAllowedUrl(url: string, sites: string[]) {
  if (!sites.length) return true;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol === "about:") return true;
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return sites.some((s) => host === s || host.endsWith(`.${s}`));
}

export function browserToolNames(p: BrowserProvider, names: string[]) {
  return names.map((n) => `mcp__${p.server}__${n}`);
}
