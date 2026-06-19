import { getDb } from "../db/database.ts";
import { migrate } from "../db/migrate.ts";
import { recordBoot } from "../db/repositories/KernelRepo.ts";
import { ensureSettings, updateSettings } from "../db/repositories/SettingsRepo.ts";
import { seedPresets } from "../db/repositories/AppRepo.ts";
import { kernelState } from "./kernelState.ts";
import { startHttpServer } from "../server/httpServer.ts";
import { broadcast } from "../server/wsGateway.ts";
import { ModelPolicy } from "../ai/ModelPolicy.ts";
import { setActiveProvider, activeProviderId, availableProviderIds } from "../ai/providers/index.ts";
import { DEFAULT_PROVIDER } from "@vibeos/shared/domain";
import { env } from "../config/env.ts";

export async function boot() {
  console.log("[boot] VibeOS kernel starting…");
  const db = getDb();
  migrate(db);

  const settings = await ensureSettings();
  await seedPresets();

  // Pick the AI backend: persisted Settings → env default → built-in default.
  // If that backend isn't available here (e.g. its CLI isn't installed), fall
  // back to the default if available, else the first available one — and persist
  // it so Settings always reflects the backend actually in use.
  const available = availableProviderIds();
  const desired = settings.provider ?? env.aiProvider ?? DEFAULT_PROVIDER;
  const effective = available.includes(desired)
    ? desired
    : available.includes(DEFAULT_PROVIDER)
      ? DEFAULT_PROVIDER
      : (available[0] ?? desired);
  setActiveProvider(effective);
  if (effective !== settings.provider) {
    await updateSettings({ provider: effective });
  }
  console.log(`[boot] AI provider: ${activeProviderId()} (available: ${available.join(", ") || "none"})`);

  const kernel = await recordBoot();
  kernelState.load();
  kernelState.setBootCount(kernel.bootCount);
  console.log(`[boot] boot #${kernel.bootCount}`);

  // Start serving immediately so the WebSocket is available right away.
  const server = startHttpServer();
  console.log("[boot] ready.");

  // Model discovery spawns the CodeBuddy CLI and can take a few seconds; run it
  // in the background so it never blocks the server. Until it resolves, the
  // ModelPolicy returns SDK defaults (effort only), which is fine.
  if (!env.aiStub) {
    void ModelPolicy.discover(settings.modelOverrides)
      .then(() => {
        // Clients connected before discovery finished saw an empty model list;
        // push the discovered models so Settings can populate.
        broadcast("s2c.models.updated", { models: ModelPolicy.available() });
      })
      .catch((e) =>
        console.warn("[models] discovery error:", e instanceof Error ? e.message : e),
      );
  } else {
    console.log("[boot] AI stub mode — skipping model discovery");
  }

  return { server };
}
