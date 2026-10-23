/**
 * Which model provider runs the team, per business (Business → AI backend). Every
 * provider still runs through Claude Code (src/lib/claude.ts), so tools, MCP servers,
 * approvals and session resume work the same; only the endpoint and model names change:
 *
 * - claude: Claude Code with the local login (or ANTHROPIC_API_KEY). Nothing is overridden.
 * - openrouter: OpenRouter's Anthropic-compatible API, with the owner's OpenRouter key.
 * - ollama: a local Ollama (0.14+ speaks the Anthropic Messages API). No key, no cost.
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
  openrouter: { baseUrl: "https://openrouter.ai/api", mainModel: "anthropic/claude-sonnet-4.5", fastModel: "anthropic/claude-haiku-4.5", needsKey: true },
  ollama: { baseUrl: "http://localhost:11434", mainModel: "qwen3-coder:30b", fastModel: "qwen3-coder:30b", needsKey: false },
};

export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);

/** Stored settings with the provider's defaults filled in. */
export function backendOf(stored: BackendSettings | null | undefined): Backend {
  const provider = isProvider(stored?.provider) ? stored.provider : "claude";
  const d = PROVIDER_DEFAULTS[provider];
  const pick = (v: string | undefined, fallback: string) => v?.trim() || fallback;
  return {
    provider,
    baseUrl: pick(stored?.baseUrl, d.baseUrl).replace(/\/+$/, ""),
    mainModel: pick(stored?.mainModel, d.mainModel),
    fastModel: pick(stored?.fastModel, pick(stored?.mainModel, d.fastModel)),
  };
}

/**
 * Environment for the Claude Code process. Claude Code also makes small side calls of
 * its own (summaries for WebFetch, titles) on its "haiku" model, so every model alias
 * points at the chosen models; otherwise those calls would ask the provider for a
 * Claude model it may not have.
 *
 * `configDir` must be a Claude Code config folder of its own: with the usual ~/.claude,
 * Claude Code sends the local Claude login to the provider instead of this token (it
 * wins over ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY).
 */
export function backendEnv(b: Backend, key: string | null, configDir: string): Record<string, string> {
  if (b.provider === "claude") return {};
  return {
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: b.baseUrl,
    // Bearer token; an empty API key keeps a stray ANTHROPIC_API_KEY from winning.
    ANTHROPIC_AUTH_TOKEN: key ?? (b.provider === "ollama" ? "ollama" : ""),
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    // Claude's thinking settings; other models may reject them.
    CLAUDE_CODE_DISABLE_THINKING: "1",
    ANTHROPIC_DEFAULT_OPUS_MODEL: b.mainModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: b.mainModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: b.fastModel,
    CLAUDE_CODE_SUBAGENT_MODEL: b.fastModel,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
