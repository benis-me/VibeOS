import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, type JSONValue } from "ai";
import { AI_PROVIDERS } from "@vibeos/shared/domain";
import { providerConfig } from "./config.ts";
import type { AiProvider, ProviderRunOptions } from "./types.ts";
import { logger } from "../../util/log.ts";

type CompatibleId = "minimax" | "zhipu" | "kimi" | "cerebras";

/** Only send options documented for the selected model; custom IDs keep API defaults. */
function requestOptions(id: CompatibleId, model: string, opts: ProviderRunOptions) {
  const out: Record<string, JSONValue> = {};
  const disabled = opts.thinking?.type === "disabled";
  if (id === "minimax") {
    // Otherwise MiniMax embeds <think> in content, which would enter the HTML stream.
    out.reasoning_split = true;
    if (model === "MiniMax-M3" && opts.thinking) {
      out.thinking = { type: disabled ? "disabled" : "adaptive" };
    }
  }
  const alwaysThinking =
    (id === "zhipu" && (model === "glm-5.3" || model === "glm-5.3-flash")) ||
    (id === "kimi" && model === "kimi-k3");
  if (alwaysThinking && (opts.thinking || opts.effort)) {
    // These models cannot disable thinking or accept "medium" / "xhigh".
    out.reasoningEffort =
      disabled || opts.effort === "low" ? "low" : opts.effort === "xhigh" ? "max" : "high";
  }
  if (
    opts.thinking &&
    ((id === "zhipu" && model === "glm-5.2") || (id === "kimi" && model === "kimi-k2.6"))
  ) {
    out.thinking = { type: disabled ? "disabled" : "enabled" };
  }
  if (id === "cerebras" && (model === "gpt-oss-120b" || model === "qwen-3.8-27b")) {
    out.reasoning_format = "parsed";
    if (opts.thinking || opts.effort) {
      out.reasoningEffort = disabled
        ? model === "qwen-3.8-27b"
          ? "none"
          : "low"
        : opts.effort === "xhigh"
          ? "high"
          : (opts.effort ?? "medium");
    }
  }
  return out;
}

/** Shared Chat Completions transport; credentials are resolved fresh after Settings edits. */
export function createCompatibleProvider(id: CompatibleId): AiProvider {
  const catalog = AI_PROVIDERS.find((p) => p.id === id)!;
  const log = logger(`provider:${id}`);
  return {
    id,
    label: catalog.label,
    async run(opts) {
      const { apiKey, baseUrl } = providerConfig(id);
      if (!apiKey) return { text: "", ok: false, error: `No ${catalog.label} API key configured` };
      try {
        const model = opts.model || catalog.seedModels![0]!.id;
        const client = createOpenAICompatible({
          name: id,
          apiKey,
          baseURL: baseUrl,
          includeUsage: true,
        });
        const result = streamText({
          model: client(model),
          system: opts.systemPrompt,
          prompt: opts.prompt,
          providerOptions: { [id]: requestOptions(id, model, opts) },
          abortSignal: opts.abort?.signal,
          maxRetries: 2,
          onError: () => {}, // The fullStream error is logged once by our catch below.
        });
        let text = "";
        // fullStream exposes upstream errors instead of silently succeeding with partial HTML.
        for await (const part of result.fullStream) {
          if (part.type === "error") throw part.error;
          if (part.type === "text-delta") {
            text += part.text;
            opts.onDelta?.(part.text);
          }
        }
        if (opts.abort?.signal.aborted) return { text: "", ok: false };
        const usage = await result.usage;
        return {
          text,
          ok: true,
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        };
      } catch (e) {
        if (opts.abort?.signal.aborted) return { text: "", ok: false };
        const error = e instanceof Error ? e.message : String(e);
        log.error(`run failed: ${error}`);
        return { text: "", ok: false, error };
      }
    },
    async discoverModels() {
      if (!catalog.modelsEndpoint) {
        return (catalog.seedModels ?? []).map((m) => ({ modelId: m.id, name: m.name }));
      }
      const { apiKey, baseUrl } = providerConfig(id);
      if (!apiKey) return [];
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = (await res.json()) as { data?: unknown };
        if (!Array.isArray(json.data)) throw new Error("Invalid model list");
        return json.data.flatMap((m) =>
          m && typeof m.id === "string" && m.id.trim()
            ? [{ modelId: m.id, name: typeof m.name === "string" ? m.name : m.id }]
            : [],
        );
      } catch (e) {
        log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
        return [];
      }
    },
  };
}
