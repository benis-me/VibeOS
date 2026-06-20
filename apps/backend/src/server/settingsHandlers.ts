import type { ServerWebSocket } from "bun";
import type { ClientToServerPayload } from "@vibeos/shared/protocol";
import { broadcast, sendTo, type WsData } from "./wsGateway.ts";
import { inferCapabilities, discoverAllProviders } from "../ai/modelDiscovery.ts";
import { ModelPolicy } from "../ai/ModelPolicy.ts";
import {
  setActiveProvider,
  activeProviderId,
  availableProviderIds,
  getProvider,
} from "../ai/providers/index.ts";
import { env } from "../config/env.ts";
import { requestWallpaper, storeUpload } from "../ai/imageCache.ts";
import { loadSettings, updateSettings } from "../db/repositories/SettingsRepo.ts";
import { logger } from "../util/log.ts";

const log = logger("router");

export async function handleSettingsUpdate(
  p: ClientToServerPayload<"c2s.settings.update">,
): Promise<void> {
  const prevProvider = activeProviderId();
  const settings = await updateSettings(p.partial);
  broadcast("s2c.settings.changed", { settings });

  if (p.partial.provider && settings.provider !== prevProvider) {
    // Switching backends: activate it, then re-discover its models. Clear the
    // stale list immediately so Settings shows the "discovering" state.
    setActiveProvider(settings.provider);
    log.info(`AI provider → ${settings.provider}`);
    broadcast("s2c.models.updated", { models: [] });
    if (!env.aiStub) {
      void ModelPolicy.discover(settings.modelOverrides)
        .then(() => broadcast("s2c.models.updated", { models: ModelPolicy.available() }))
        .catch((e) => log.warn(`model re-discovery failed: ${e instanceof Error ? e.message : e}`));
    }
  } else if (p.partial.modelOverrides) {
    ModelPolicy.recompute(settings.modelOverrides);
  }
}

export function handleProviderScan(): void {
  // On-demand: re-detect which CLIs are installed and re-discover the active
  // provider's models. Availability is instant; models discover in the
  // background (clear the list first so Settings shows the scanning state).
  broadcast("s2c.providers.updated", { availableProviders: availableProviderIds() });
  if (!env.aiStub) {
    broadcast("s2c.models.updated", { models: [] });
    void ModelPolicy.discover(loadSettings().modelOverrides)
      .then(() => broadcast("s2c.models.updated", { models: ModelPolicy.available() }))
      .catch((e) => log.warn(`scan discovery failed: ${e instanceof Error ? e.message : e}`));
    // Re-discover every provider's models for the picker.
    discoverAllProviders();
  }
}

export async function handleProviderFetchModels(
  p: ClientToServerPayload<"c2s.provider.fetchModels">,
): Promise<void> {
  // Refresh one provider's model list and broadcast it. Discovered lists are
  // ephemeral (not persisted) so they never overwrite user-added models.
  const { providerId } = p;
  try {
    const provider = await getProvider(providerId);
    const discovered = await provider.discoverModels();
    broadcast("s2c.provider.models", {
      providerId,
      models: discovered.map((m) => ({
        id: m.modelId,
        name: m.name,
        capabilities: inferCapabilities(m.modelId),
      })),
    });
  } catch (e) {
    log.warn(`fetchModels(${providerId}) failed: ${e instanceof Error ? e.message : e}`);
    broadcast("s2c.provider.models", { providerId, models: [] });
  }
}

export async function handleWallpaperUpload(
  ws: ServerWebSocket<WsData>,
  p: ClientToServerPayload<"c2s.wallpaper.upload">,
): Promise<void> {
  const path = await storeUpload(p.dataUrl);
  if (!path) {
    sendTo(ws, "s2c.error", { code: "wallpaper_bad_image" });
    return;
  }
  const settings = await updateSettings({ prefs: { wallpaper: path } });
  broadcast("s2c.settings.changed", { settings });
}

export async function handleWallpaperGenerate(
  ws: ServerWebSocket<WsData>,
  p: ClientToServerPayload<"c2s.wallpaper.generate">,
): Promise<void> {
  const path = requestWallpaper(p.prompt);
  if (!path) {
    sendTo(ws, "s2c.error", { code: "wallpaper_no_image_model" });
    return;
  }
  // The path serves once generation finishes (the /api/img route awaits it);
  // persist it now so the desktop swaps to it the moment it's ready.
  const settings = await updateSettings({ prefs: { wallpaper: path } });
  broadcast("s2c.settings.changed", { settings });
}
