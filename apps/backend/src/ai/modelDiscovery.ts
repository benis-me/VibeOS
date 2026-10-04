import {
  AI_PROVIDERS,
  type ModelCapability,
  type ProviderId,
  type ProviderModel,
} from "@vibeos/shared/domain";
import { availableProviderIds, getProvider } from "./providers/index.ts";
import { broadcast } from "../server/wsGateway.ts";
import { logger } from "../util/log.ts";

const log = logger("models");

/** Best-effort capability tags for a discovered model id. */
export function inferCapabilities(id: string): ModelCapability[] {
  // A refreshed list must retain verified capabilities instead of labelling every LLM as vision.
  const known = AI_PROVIDERS.flatMap((p) => p.seedModels ?? []).find((m) => m.id === id);
  if (known?.capabilities) return known.capabilities;
  const s = id.toLowerCase();
  if (/image|imagen|flux|dall|nano-banana|ideogram|recraft|seedream|qwen-image/.test(s)) {
    return ["image"];
  }
  return ["text", "vision"];
}

// Reconnects reuse a recent list instead of spawning CLIs and calling /models again.
const TTL = 5 * 60_000;
const recent = new Map<string, { at: number; models: ProviderModel[] }>();

/** Broadcast a provider's models and remember them for reconnects. */
export function publishModels(providerId: ProviderId, found: { modelId: string; name: string }[]) {
  const models: ProviderModel[] = found.map((m) => ({
    id: m.modelId,
    name: m.name,
    capabilities: inferCapabilities(m.modelId),
  }));
  recent.set(providerId, { at: Date.now(), models });
  broadcast("s2c.provider.models", { providerId, models });
}

/**
 * Discover models for EVERY available provider (not just the active one) and
 * broadcast them per-provider, so the Default Models picker can list models from
 * all configured providers + all installed CLIs. Discovered lists are ephemeral
 * (re-discovered each boot) — they never clobber user-added custom models.
 */
export function discoverAllProviders(): void {
  for (const id of availableProviderIds()) {
    const hit = recent.get(id);
    if (hit && Date.now() - hit.at < TTL) {
      broadcast("s2c.provider.models", { providerId: id, models: hit.models });
      continue;
    }
    void getProvider(id)
      .then((p) => p.discoverModels())
      .then((ms) => {
        if (ms.length) publishModels(id, ms);
      })
      .catch((e) => log.warn(`discover ${id} failed: ${e instanceof Error ? e.message : e}`));
  }
}
