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

export type BackendSettings = { provider: Provider; baseUrl?: string; mainModel?: string; fastModel?: string };

export type Backend = { provider: Provider; baseUrl: string; mainModel: string; fastModel: string };

export const PROVIDER_DEFAULTS: Record<Provider, { baseUrl: string; mainModel: string; fastModel: string; needsKey: boolean }> = {
  claude: { baseUrl: "", mainModel: "", fastModel: "", needsKey: false },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", mainModel: "anthropic/claude-sonnet-4.5", fastModel: "anthropic/claude-haiku-4.5", needsKey: true },
  ollama: { baseUrl: "http://localhost:11434", mainModel: "qwen3-coder:30b", fastModel: "qwen3-coder:30b", needsKey: false },
};

export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);

/** Stored settings with the provider's defaults filled in. */
export function backendOf(stored: BackendSettings | null | undefined): Backend {
  const provider = isProvider(stored?.provider) ? stored.provider : "claude";
  const d = PROVIDER_DEFAULTS[provider];
  const pick = (v: string | undefined, fallback: string) => v?.trim() || fallback;
  // Ollama's own root: "/v1" (its OpenAI-compatible API) is added where it's used.
  const url = pick(stored?.baseUrl, d.baseUrl).replace(/\/+$/, "");
  return {
    provider,
    baseUrl: provider === "ollama" ? url.replace(/\/v1$/, "") : url,
    mainModel: pick(stored?.mainModel, d.mainModel),
    fastModel: pick(stored?.fastModel, pick(stored?.mainModel, d.fastModel)),
  };
}
