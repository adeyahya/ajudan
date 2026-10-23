/**
 * Which model provider runs the team, per business (Business → AI backend):
 *
 * - claude: Claude Code with the local login (or ANTHROPIC_API_KEY), src/lib/claude.ts.
 * - openrouter: OpenRouter with the owner's key, on the AI SDK engine (src/lib/agent/).
 * - ollama: a local Ollama, on the AI SDK engine. No key, no cost.
 *
 * Both engines take the same runAgent() options, so tools, approvals, supervision and
 * resuming after an approval work alike.
 *
 * The key lives in the Keychain (src/lib/secrets.ts, BACKEND_KEY), never in the database.
 * Safe to import from Next.js: no SDK here.
 */

export const PROVIDERS = ["claude", "openrouter", "ollama"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * OpenRouter routing: "pick" uses the chosen models; "free" sends every call to
 * OpenRouter's Free Models Router (a free model that supports the call's tools);
 * "auto" lets OpenRouter's Auto Router choose (billed at the chosen model's price).
 */
export type OpenRouterRoute = "pick" | "free" | "auto";

export type BackendSettings = {
  provider: Provider;
  baseUrl?: string;
  mainModel?: string;
  fastModel?: string;
  route?: OpenRouterRoute;
  /** OpenRouter, route "pick": when a chosen model is down, rate-limited or out of credits, try a free one. */
  fallbackToFree?: boolean;
};

export type Backend = {
  provider: Provider;
  baseUrl: string;
  /** Claude: "" means the default (MODELS in src/lib/claude.ts). */
  mainModel: string;
  fastModel: string;
  /** OpenRouter fallback models, tried in order after the chosen one. */
  fallbacks: string[];
};

export const FREE_ROUTER = "openrouter/free";
export const AUTO_ROUTER = "openrouter/auto";

/** The Claude models Claude Code can run (Business → AI backend). */
export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "most capable" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "fast and capable" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "fastest, lightest" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", note: "" },
] as const;

export const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; mainModel: string; fastModel: string; needsKey: boolean }> = {
  // Claude's defaults come from MODELS (src/lib/claude.ts, AJUDAN_MODEL / AJUDAN_FAST_MODEL).
  claude: { baseUrl: "", mainModel: "", fastModel: "", needsKey: false },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", mainModel: "anthropic/claude-sonnet-4.5", fastModel: "anthropic/claude-haiku-4.5", needsKey: true },
  ollama: { baseUrl: "http://localhost:11434", mainModel: "qwen3-coder:30b", fastModel: "qwen3-coder:30b", needsKey: false },
};

/** One model in the picker (Business → AI backend), from OpenRouter's catalog, Ollama or the Claude list. */
export type ModelOption = {
  id: string;
  name: string;
  /** Context window in tokens. */
  context?: number;
  /** USD per million tokens, in and out; null when the price isn't fixed (a router). */
  price?: { input: number; output: number } | null;
  free?: boolean;
  tools?: boolean;
  vision?: boolean;
  /** Unix seconds (OpenRouter) for sorting by newest. */
  created?: number;
  note?: string;
};

export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);

/** Stored settings with the provider's defaults filled in. */
export function backendOf(stored: BackendSettings | null | undefined): Backend {
  const provider = isProvider(stored?.provider) ? stored.provider : "claude";
  const d = PROVIDER_DEFAULTS[provider];
  const pick = (v: string | undefined, fallback: string) => v?.trim() || fallback;
  // Ollama's own root: "/v1" (its OpenAI-compatible API) is added where it's used.
  const url = pick(stored?.baseUrl, d.baseUrl).replace(/\/+$/, "");
  const baseUrl = provider === "ollama" ? url.replace(/\/v1$/, "") : url;
  if (provider === "claude") return { provider, baseUrl: "", mainModel: pick(stored?.mainModel, ""), fastModel: pick(stored?.fastModel, ""), fallbacks: [] };
  const route = provider === "openrouter" ? (stored?.route ?? "pick") : "pick";
  if (route === "free") return { provider, baseUrl, mainModel: FREE_ROUTER, fastModel: FREE_ROUTER, fallbacks: [] };
  if (route === "auto") return { provider, baseUrl, mainModel: AUTO_ROUTER, fastModel: AUTO_ROUTER, fallbacks: stored?.fallbackToFree ? [FREE_ROUTER] : [] };
  const mainModel = pick(stored?.mainModel, d.mainModel);
  const fastModel = pick(stored?.fastModel, pick(stored?.mainModel, d.fastModel));
  const fallbacks = provider === "openrouter" && stored?.fallbackToFree ? [FREE_ROUTER] : [];
  return { provider, baseUrl, mainModel, fastModel, fallbacks };
}
