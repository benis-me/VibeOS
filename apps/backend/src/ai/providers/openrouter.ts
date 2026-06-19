import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { env } from "../../config/env.ts";
import type { AiProvider, DiscoveredModel, ProviderRunOptions, RunResult } from "./types.ts";
import { logger } from "../../util/log.ts";

const log = logger("provider:openrouter");

/** Used when the policy can't pick a model (e.g. discovery failed, no key). */
const DEFAULT_MODEL = "openai/gpt-4o-mini";

// Memoize the client by (baseURL, apiKey) so we don't rebuild it every run.
let clientCache: { key: string; client: ReturnType<typeof createOpenAICompatible> } | null = null;
function client() {
  const key = `${env.aiBaseUrl}|${env.aiApiKey ?? ""}`;
  if (clientCache?.key !== key) {
    clientCache = {
      key,
      client: createOpenAICompatible({ name: "openrouter", baseURL: env.aiBaseUrl, apiKey: env.aiApiKey }),
    };
  }
  return clientCache.client;
}

/**
 * OpenAI-compatible HTTP provider, defaulting to OpenRouter. Unlike the CLI
 * providers it's an API call via the Vercel AI SDK, so it's stateless — VibeOS
 * already carries per-window context in the prompt, so no session/resume is
 * needed. Point `VIBEOS_AI_BASE_URL` elsewhere (OpenAI, Together, a local LLM)
 * to reuse this for any OpenAI-compatible endpoint.
 */
class OpenRouterProvider implements AiProvider {
  readonly id = "openrouter" as const;
  readonly label = "OpenRouter";

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    if (!env.aiApiKey) {
      return {
        text: "",
        ok: false,
        error: `No API key — set OPENROUTER_API_KEY (or VIBEOS_AI_API_KEY) for ${env.aiBaseUrl}`,
      };
    }
    try {
      const result = streamText({
        model: client()(opts.model || DEFAULT_MODEL),
        system: opts.systemPrompt,
        prompt: opts.prompt,
        abortSignal: opts.abort?.signal,
        maxRetries: 2,
      });

      let full = "";
      for await (const delta of result.textStream) {
        full += delta;
        opts.onDelta?.(delta);
      }
      const usage = await Promise.resolve(result.usage).catch(() => undefined);
      // Stateless: no sessionId — continuity comes from the assembled prompt.
      return {
        text: full,
        ok: true,
        usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined,
      };
    } catch (e) {
      if (opts.abort?.signal.aborted) return { text: "", ok: false };
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`run failed: ${msg}`);
      return { text: "", ok: false, error: msg };
    }
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    try {
      const headers: Record<string, string> = {};
      if (env.aiApiKey) headers.Authorization = `Bearer ${env.aiApiKey}`;
      const res = await fetch(`${env.aiBaseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`model discovery failed: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = (await res.json()) as {
        data?: Array<{ id: string; name?: string; description?: string }>;
      };
      const data = Array.isArray(json.data) ? json.data : [];
      return data.map((m) => ({
        modelId: m.id,
        name: m.name ?? m.id,
        description: m.description,
      }));
    } catch (e) {
      log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }
}

export const openrouterProvider = new OpenRouterProvider();
