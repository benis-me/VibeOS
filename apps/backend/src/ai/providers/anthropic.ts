import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { providerConfig } from "./config.ts";
import type { AiProvider, DiscoveredModel, ProviderRunOptions, RunResult } from "./types.ts";
import { logger } from "../../util/log.ts";

const log = logger("provider:anthropic");

const DEFAULT_MODEL = "claude-sonnet-4-6";
const VERSION = "2023-06-01";

let cache: { key: string; client: ReturnType<typeof createAnthropic> } | null = null;
function client(apiKey: string, baseURL: string) {
  const k = `${baseURL}|${apiKey}`;
  if (cache?.key !== k) cache = { key: k, client: createAnthropic({ apiKey, baseURL }) };
  return cache.client;
}

/** Anthropic (Claude API) via the Vercel AI SDK. Vision-input only — no image gen. */
class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic";

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    const { apiKey, baseUrl } = providerConfig("anthropic");
    if (!apiKey) return { text: "", ok: false, error: "No Anthropic API key configured" };
    try {
      const result = streamText({
        model: client(apiKey, `${baseUrl}/v1`)(opts.model || DEFAULT_MODEL),
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
    const { apiKey, baseUrl } = providerConfig("anthropic");
    if (!apiKey) return [];
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { "x-api-key": apiKey, "anthropic-version": VERSION },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`model discovery failed: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = (await res.json()) as {
        data?: Array<{ id: string; display_name?: string }>;
      };
      return (json.data ?? []).map((m) => ({ modelId: m.id, name: m.display_name ?? m.id }));
    } catch (e) {
      log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }
}

export const anthropicProvider = new AnthropicProvider();
