import type { ProviderId } from "@vibeos/shared/domain";
import { AI_PROVIDERS } from "@vibeos/shared/domain";
import { loadSettings } from "../../db/repositories/SettingsRepo.ts";

/** Env vars consulted (in order) for a provider's key when Settings has none. */
const ENV_KEYS: Partial<Record<ProviderId, string[]>> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY", "VIBEOS_AI_API_KEY", "OPENAI_API_KEY"],
  fal: ["FAL_KEY", "FAL_API_KEY"],
};

export interface ResolvedProviderConfig {
  apiKey?: string;
  /** Base URL with no trailing slash (Settings override → catalog default). */
  baseUrl: string;
  extra?: Record<string, string>;
}

/** Resolve an API provider's connection config: Settings first, then env. */
export function providerConfig(id: ProviderId): ResolvedProviderConfig {
  const cfg = loadSettings().apiProviders[id] ?? {};
  const cat = AI_PROVIDERS.find((p) => p.id === id);
  const envKey = (ENV_KEYS[id] ?? []).map((k) => process.env[k]).find(Boolean);
  return {
    apiKey: cfg.apiKey || envKey,
    baseUrl: (cfg.baseUrl || cat?.defaultBaseUrl || "").replace(/\/+$/, ""),
    extra: cfg.extra,
  };
}

/** Whether an API provider has a usable key (Settings or env). */
export function hasApiKey(id: ProviderId): boolean {
  return !!providerConfig(id).apiKey;
}
