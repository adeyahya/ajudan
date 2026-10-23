import { randomUUID } from "node:crypto";
import type { PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { generateText, isStepCount, jsonSchema, Output, tool, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import { z } from "zod";
import type { Backend } from "@/lib/backend";
import type { RunAgentOptions, RunAgentResult } from "@/lib/claude";
import { builtinTools, type EngineTool, type ToolOut } from "./builtin-tools";
import { connectMcp } from "./mcp";
import { costOf, languageModel } from "./models";
import { loadSession, saveSession } from "./sessions";

/**
 * runAgent() on OpenRouter or Ollama: the Vercel AI SDK tool loop, behaving like the
 * Claude Code runs it replaces so the handlers don't change:
 *
 * - tools: Claude Code's built-ins with the same names and inputs (builtin-tools.ts)
 *   plus the run's MCP servers as mcp__<server>__<tool> (mcp.ts);
 * - permissions: tools in allowedTools run, disallowedTools don't exist, every other
 *   call goes through canUseTool first (its updatedInput is what runs);
 * - an approval stop (canUseTool aborts the run) keeps the conversation up to that call,
 *   so the decision resumes it (sessions.ts);
 * - onMessage gets Claude Code-shaped messages: session_id, assistant text and tool_use.
 */

type Emit = (m: Record<string, unknown>) => void;

export async function runWithAiSdk<T>(opts: RunAgentOptions, backend: Backend, model: string, key: string | null): Promise<RunAgentResult<T>> {
  const signal = opts.abortController?.signal ?? new AbortController().signal;
  const sessionId = opts.resume ?? randomUUID();
  const earlier = opts.resume ? loadSession(opts.cwd, opts.resume) : [];
  const messages: ModelMessage[] = [...earlier, { role: "user", content: opts.prompt }];
  let seen = messages; // the conversation as of the step running now
  const emit: Emit = (m) => opts.onMessage?.({ ...m, session_id: sessionId } as unknown as SDKMessage);
  emit({ type: "system", subtype: "init" });

  const allowed = new Set(opts.allowedTools ?? []);
  const denied = new Set(opts.disallowedTools ?? []);
  const mcp = await connectMcp(opts.mcpServers ?? {});
  let cost = 0;
  try {
    const engineTools = [
      ...builtinTools(opts.tools ?? [], { cwd: opts.cwd, sandbox: opts.sandbox, plugins: opts.plugins ?? [], skills: opts.skills ?? [] }),
      ...mcp.tools,
    ].filter((t) => !denied.has(t.name));

    const tools: ToolSet = {};
    for (const t of engineTools) {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema<Record<string, unknown>>(t.inputSchema),
        execute: (input, { toolCallId }) => runGated(t, input, toolCallId),
        toModelOutput: ({ output }) => toModelOutput(output as ToolOut),
      });
    }

    /** Permission first (like Claude Code), then the tool; a stop for an approval ends the run here. */
    const runGated = async (t: EngineTool, input: Record<string, unknown>, toolCallId: string): Promise<ToolOut> => {
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id: toolCallId, name: t.name, input }] } });
      let args = input;
      if (!allowed.has(t.name)) {
        const fallback: PermissionResult = { behavior: "deny", message: `${t.name} isn't available in this run.` };
        const decision: PermissionResult =
          (opts.canUseTool && (await opts.canUseTool(t.name, input, { signal, toolUseID: toolCallId, suggestions: [] } as unknown as Parameters<NonNullable<RunAgentOptions["canUseTool"]>>[2]))) || fallback;
        if (decision.behavior === "deny") {
          if (signal.aborted) {
            // Waiting for the owner (or cancelled): keep this call in the conversation for the resume.
            saveSession(opts.cwd, sessionId, [
              ...seen,
              { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName: t.name, input }] },
              { role: "tool", content: [{ type: "tool-result", toolCallId, toolName: t.name, output: { type: "error-text", value: decision.message } }] },
            ]);
            throw signal.reason ?? new Error("Stopped");
          }
          return { text: decision.message, isError: true };
        }
        args = (decision.updatedInput as Record<string, unknown> | undefined) ?? input;
      }
      try {
        return await t.run(args, { signal, toolCallId });
      } catch (e) {
        if (signal.aborted) throw e;
        return { text: `${t.name} failed: ${(e as Error).message}`, isError: true };
      }
    };

    const budgetHit: StopCondition<ToolSet> = () => opts.maxBudgetUsd !== undefined && cost >= opts.maxBudgetUsd;
    const res = await generateText({
      model: languageModel(backend, model, key),
      system: opts.systemPrompt,
      messages,
      tools,
      stopWhen: [isStepCount(opts.maxTurns ?? 30), budgetHit],
      output: opts.outputSchema ? Output.object({ schema: opts.outputSchema as z.ZodType<T> }) : undefined,
      abortSignal: signal,
      maxRetries: 2,
      prepareStep: ({ messages: now }) => {
        // Saved before every step: a stop (approval, cancel, crash) loses at most this one.
        seen = now;
        saveSession(opts.cwd, sessionId, now);
        return undefined;
      },
      onStepEnd: (step) => {
        cost += costOf(step.providerMetadata);
        if (step.text.trim()) emit({ type: "assistant", message: { content: [{ type: "text", text: step.text }] } });
      },
    });
    saveSession(opts.cwd, sessionId, [...messages, ...res.responseMessages]);

    const text = res.text || res.steps.map((s) => s.text).filter(Boolean).join("\n");
    if (budgetHit({ steps: res.steps })) {
      return { text, structured: undefined, sessionId, costUsd: cost, ok: false, error: `Stopped at the budget ($${opts.maxBudgetUsd})` };
    }
    if (!opts.outputSchema) return { text, structured: undefined, sessionId, costUsd: cost, ok: true };
    const parsed = opts.outputSchema.safeParse(safeOutput(res) ?? tryParseJson(text));
    return parsed.success
      ? { text, structured: parsed.data as T, sessionId, costUsd: cost, ok: true }
      : { text, structured: undefined, sessionId, costUsd: cost, ok: false, error: `Output did not match schema: ${parsed.error.message}` };
  } catch (e) {
    if (signal.aborted) throw e;
    return { text: "", structured: undefined, sessionId, costUsd: cost, ok: false, error: `${backend.provider} run failed: ${(e as Error).message}` };
  } finally {
    await mcp.close();
  }
}

function toModelOutput(out: ToolOut) {
  if (out.images?.length) {
    return {
      type: "content" as const,
      value: [
        { type: "text" as const, text: out.text },
        ...out.images.map((i) => ({ type: "file" as const, mediaType: i.mediaType, data: { type: "data" as const, data: i.data } })),
      ],
    };
  }
  return out.isError ? { type: "error-text" as const, value: out.text } : { type: "text" as const, value: out.text };
}

/** The structured output, or undefined when the model didn't produce valid JSON (then the text is tried). */
function safeOutput(res: { output: unknown }) {
  try {
    return res.output;
  } catch {
    return undefined;
  }
}

function tryParseJson(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : s);
  } catch {
    return undefined;
  }
}
