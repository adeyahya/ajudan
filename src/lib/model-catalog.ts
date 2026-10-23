import { CLAUDE_MODELS, FREE_ROUTER, type Backend, type ModelOption } from "@/lib/backend";

/**
 * Models to pick from on Business → AI backend: OpenRouter's public catalog (no key
 * needed, cached for an hour), the models installed in the business's Ollama, or the
 * Claude models Claude Code runs. Only reads; nothing is sent to a model.
 */

const HOUR = 60 * 60_000;
let openRouterCache: { at: number; models: ModelOption[] } | undefined;

type OpenRouterModel = {
  id: string;
  name: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
};

/** OpenRouter's chat models, newest first; routers (free, auto) first of all. */
export async function openRouterModels(): Promise<ModelOption[]> {
  if (openRouterCache && Date.now() - openRouterCache.at < HOUR) return openRouterCache.models;
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
  const { data } = (await res.json()) as { data: OpenRouterModel[] };
  const models = data
    .filter((m) => (m.architecture?.output_modalities ?? ["text"]).includes("text"))
    .map((m): ModelOption => {
      const input = Number(m.pricing?.prompt);
      const output = Number(m.pricing?.completion);
      const fixed = input >= 0 && output >= 0;
      return {
        id: m.id,
        name: m.name,
        context: m.context_length,
        price: fixed ? { input: input * 1e6, output: output * 1e6 } : null,
        free: fixed && input === 0 && output === 0,
        tools: m.supported_parameters?.includes("tools") ?? false,
        vision: m.architecture?.input_modalities?.includes("image") ?? false,
        created: m.created,
      };
    })
    .sort((a, b) => Number(b.id.startsWith("openrouter/")) - Number(a.id.startsWith("openrouter/")) || (b.created ?? 0) - (a.created ?? 0));
  const free = models.find((m) => m.id === FREE_ROUTER);
  if (free) free.note = "picks a free model that supports the call's tools";
  openRouterCache = { at: Date.now(), models };
  return models;
}

/** The models installed in this Ollama, with what each can do (tools, images). */
export async function ollamaModels(backend: Backend): Promise<ModelOption[]> {
  const res = await fetch(`${backend.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const { models = [] } = (await res.json()) as { models?: { name: string; size?: number; details?: { parameter_size?: string } }[] };
  return Promise.all(
    models.slice(0, 50).map(async (m): Promise<ModelOption> => {
      // /api/show lists capabilities ("tools", "vision") and the context length.
      const show = await fetch(`${backend.baseUrl}/api/show`, { method: "POST", body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(5000) })
        .then((r) => (r.ok ? (r.json() as Promise<{ capabilities?: string[]; model_info?: Record<string, unknown> }>) : undefined))
        .catch(() => undefined);
      const ctx = Object.entries(show?.model_info ?? {}).find(([k]) => k.endsWith(".context_length"))?.[1];
      return {
        id: m.name,
        name: m.name,
        context: typeof ctx === "number" ? ctx : undefined,
        price: { input: 0, output: 0 },
        free: true,
        tools: show?.capabilities ? show.capabilities.includes("tools") : undefined,
        vision: show?.capabilities?.includes("vision"),
        note: [m.details?.parameter_size, m.size ? `${(m.size / 1e9).toFixed(1)} GB` : ""].filter(Boolean).join(" · "),
      };
    }),
  );
}

export function claudeModels(): ModelOption[] {
  return CLAUDE_MODELS.map((m) => ({ id: m.id, name: m.name, tools: true, vision: true, note: m.note }));
}
