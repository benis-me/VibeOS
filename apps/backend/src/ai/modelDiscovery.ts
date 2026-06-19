import type { ModelCapability } from "@vibeos/shared/domain";
import { availableProviderIds, getProvider } from "./providers/index.ts";
import { broadcast } from "../server/wsGateway.ts";
import { logger } from "../util/log.ts";

const log = logger("models");

/** Best-effort capability tags for a discovered model id. */
export function inferCapabilities(id: string): ModelCapability[] {
  const s = id.toLowerCase();
  if (/image|imagen|flux|dall|nano-banana|ideogram|recraft|seedream|qwen-image/.test(s)) {
    return ["image"];
  }
  return ["text", "vision"];
}

/**
 * Discover models for EVERY available provider (not just the active one) and
 * broadcast them per-provider, so the Default Models picker can list models from
 * all configured providers + all installed CLIs. Discovered lists are ephemeral
 * (re-discovered each boot) — they never clobber user-added custom models.
 */
export function discoverAllProviders(): void {
  for (const id of availableProviderIds()) {
    void getProvider(id)
      .then((p) => p.discoverModels())
      .then((ms) => {
        if (!ms.length) return;
        broadcast("s2c.provider.models", {
          providerId: id,
          models: ms.map((m) => ({
            id: m.modelId,
            name: m.name,
            capabilities: inferCapabilities(m.modelId),
          })),
        });
      })
      .catch((e) => log.warn(`discover ${id} failed: ${e instanceof Error ? e.message : e}`));
  }
}
