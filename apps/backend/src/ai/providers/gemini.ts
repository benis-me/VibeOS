import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import { providerConfig } from "./config.ts";
import type { AiProvider, DiscoveredModel, ProviderRunOptions, RunResult } from "./types.ts";
import { logger } from "../../util/log.ts";

const log = logger("provider:gemini");

const DEFAULT_MODEL = "gemini-2.5-flash";

let cache: { key: string; client: ReturnType<typeof createGoogleGenerativeAI> } | null = null;
function client(apiKey: string, baseURL: string) {
  const k = `${baseURL}|${apiKey}`;
  if (cache?.key !== k) cache = { key: k, client: createGoogleGenerativeAI({ apiKey, baseURL }) };
  return cache.client;
}

/** Google Gemini (Generative Language API, key-based) via the Vercel AI SDK. */
class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  readonly label = "Gemini";

  async run(opts: ProviderRunOptions): Promise<RunResult> {
    const { apiKey, baseUrl } = providerConfig("gemini");
    if (!apiKey) return { text: "", ok: false, error: "No Gemini API key configured" };
    try {
      const result = streamText({
        model: client(apiKey, `${baseUrl}/v1beta`)(opts.model || DEFAULT_MODEL),
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
        usage: usage
          ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
          : undefined,
      };
    } catch (e) {
      if (opts.abort?.signal.aborted) return { text: "", ok: false };
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`run failed: ${msg}`);
      return { text: "", ok: false, error: msg };
    }
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    const { apiKey, baseUrl } = providerConfig("gemini");
    if (!apiKey) return [];
    try {
      const res = await fetch(`${baseUrl}/v1beta/models`, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`model discovery failed: ${res.status} ${res.statusText}`);
        return [];
      }
      const json = (await res.json()) as {
        models?: Array<{ name: string; displayName?: string; description?: string }>;
      };
      return (json.models ?? []).map((m) => ({
        modelId: m.name.replace(/^models\//, ""),
        name: m.displayName ?? m.name.replace(/^models\//, ""),
        description: m.description,
      }));
    } catch (e) {
      log.warn(`model discovery failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }
}

export const geminiProvider = new GeminiProvider();
