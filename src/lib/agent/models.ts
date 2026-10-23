import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel, ProviderMetadata } from "ai";
import type { Backend } from "@/lib/backend";

/**
 * The AI SDK model for a business on OpenRouter or Ollama (src/lib/backend.ts). Claude
 * runs through Claude Code instead (src/lib/claude.ts), never through here.
 */
export function languageModel(backend: Backend, modelId: string, key: string | null): LanguageModel {
  if (backend.provider === "openrouter") {
    // Usage accounting makes OpenRouter report each call's real cost (costOf below).
    return createOpenRouter({ apiKey: key ?? "", baseURL: backend.baseUrl }).chat(modelId, { usage: { include: true } });
  }
  if (backend.provider === "ollama") {
    // Ollama's OpenAI-compatible API; it needs a key to be set, not a real one.
    return createOpenAICompatible({ name: "ollama", baseURL: `${backend.baseUrl}/v1`, apiKey: "ollama", supportsStructuredOutputs: true }).chatModel(modelId);
  }
  throw new Error("Claude runs through Claude Code, not the AI SDK engine");
}

/** What one model call cost in USD: OpenRouter says so; Ollama is free. */
export function costOf(meta: ProviderMetadata | undefined): number {
  const usage = (meta?.openrouter as { usage?: { cost?: number } } | undefined)?.usage;
  return typeof usage?.cost === "number" ? usage.cost : 0;
}
