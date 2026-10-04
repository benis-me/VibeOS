import { changeSystemMemory } from "../db/repositories/SystemMemoryRepo.ts";
import { cancelMemoryExtraction } from "../ai/systemMemory.ts";
import { activateSkin } from "../db/repositories/SkinRepo.ts";
import { broadcastSkins } from "../ai/skins.ts";
import type { ServerWebSocket } from "bun";
import type { ClientToServerPayload } from "@vibeos/shared/protocol";
import { broadcast, sendTo, type WsData } from "./wsGateway.ts";
import { publishModels } from "../ai/modelDiscovery.ts";
import { ModelPolicy } from "../ai/ModelPolicy.ts";
import {
  setActiveProvider,
  activeProviderId,
  availableProviderIds,
  getProvider,
} from "../ai/providers/index.ts";
import { env } from "../config/env.ts";
import { requestWallpaper, storeUpload } from "../ai/imageCache.ts";
import { loadSettings, updateSettings, updateProfile } from "../db/repositories/SettingsRepo.ts";
import { logger } from "../util/log.ts";

const log = logger("router");

export async function handleProfileUpdate(
  p: ClientToServerPayload<"c2s.profile.update">,
): Promise<void> {
  const settings = await updateProfile(p);
  broadcast("s2c.settings.changed", { settings });
}

export async function handleSettingsUpdate(
  p: ClientToServerPayload<"c2s.settings.update">,
): Promise<void> {
  const prevProvider = activeProviderId();
  const { skin, ...partial } = p.partial;
  if (skin !== undefined) await activateSkin(skin);
  if (partial.prefs?.memoryEnabled !== undefined) {
    cancelMemoryExtraction();
    broadcast(
      "s2c.memory.state",
      await changeSystemMemory({ action: "toggle", enabled: partial.prefs.memoryEnabled === true }),
    );
  }
  const settings = await updateSettings(partial);
  if (skin !== undefined) broadcastSkins();
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

export async function handleProviderFetchModels(
  p: ClientToServerPayload<"c2s.provider.fetchModels">,
): Promise<void> {
  // Refresh one provider's model list and broadcast it. Discovered lists are
  // ephemeral (not persisted) so they never overwrite user-added models.
  const { providerId } = p;
  try {
    const provider = await getProvider(providerId);
    // This is the explicit, user-triggered fetch — prefer heavyweight live
    // discovery (e.g. CodeBuddy's PTY `/model list` scrape) when the provider
    // offers it; it never runs on boot/scan.
    publishModels(providerId, await (provider.discoverModelsLive?.() ?? provider.discoverModels()));
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
