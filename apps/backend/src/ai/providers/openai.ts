import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { providerConfig } from "./config.ts";
import type { AiProvider, DiscoveredModel, ProviderRunOptions, RunResult } from "./types.ts";
import { logger } from "../../util/log.ts";

const log = logger("provider:openai");

/** Used when the policy can't pick a model (e.g. discovery failed). */
const DEFAULT_MODEL = "gpt-5.4-mini";

let cache: { key: string; client: ReturnType<typeof createOpenAI> } | null = null;
function client(apiKey: string, baseURL: string) {
  const k = `${baseURL}|${apiKey}`;
  if (cache?.key !== k) cache = { key: k, client: createOpenAI({ apiKey, baseURL }) };
  return cache.client;
}

/** OpenAI via the Vercel AI SDK; key + base URL come from Settings (or env). */
class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI";

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    const { apiKey, baseUrl } = providerConfig("openai");
    if (!apiKey) return { text: "", ok: false, error: "No OpenAI API key configured" };
    try {
      const result = streamText({
        model: client(apiKey, baseUrl)(opts.model || DEFAULT_MODEL),
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
    const { apiKey, baseUrl } = providerConfig("openai");
    if (!apiKey) return [];
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`model discovery failed: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      return (json.data ?? []).map((m) => ({ modelId: m.id, name: m.id }));
    } catch (e) {
      log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }
}

export const openaiProvider = new OpenAiProvider();
