import type { ProviderId } from "@vibeos/shared/domain";
import { DEFAULT_PROVIDER } from "@vibeos/shared/domain";
import type { AiProvider } from "./types.ts";
import { whichBinary } from "./detect.ts";

export type { AiProvider, DiscoveredModel, ProviderRunOptions, RunResult, ThinkingConfig } from "./types.ts";

/**
 * Lazy provider loaders: only the SDK for a provider that's actually used gets
 * imported/evaluated, so booting on Codex never loads the CodeBuddy/Claude SDKs
 * (and a broken/missing SDK can't crash boot — it only breaks its own provider).
 */
const LOADERS: Partial<Record<ProviderId, () => Promise<AiProvider>>> = {
  codebuddy: async () => (await import("./codebuddy.ts")).codebuddyProvider,
  claude: async () => (await import("./claude.ts")).claudeProvider,
  codex: async () => (await import("./codex.ts")).codexProvider,
  openrouter: async () => (await import("./openrouter.ts")).openrouterProvider,
  // openai / anthropic / gemini / fal are wired in Phase 2.
};

/** CLI providers require their binary on PATH; the names match the binaries. */
const CLI_BINARIES: Partial<Record<ProviderId, string>> = {
  codebuddy: "codebuddy",
  claude: "claude",
  codex: "codex",
};

const cache = new Map<ProviderId, AiProvider>();

let activeId: ProviderId = DEFAULT_PROVIDER;

/** Switch the active backend. Unknown ids are ignored (keeps the current one). */
export function setActiveProvider(id: ProviderId): void {
  if (LOADERS[id]) activeId = id;
}

export function activeProviderId(): ProviderId {
  return activeId;
}

export async function getProvider(id: ProviderId): Promise<AiProvider> {
  const hit = cache.get(id);
  if (hit) return hit;
  const loader = LOADERS[id];
  if (!loader) throw new Error(`No provider loader registered for "${id}"`);
  const provider = await loader();
  cache.set(id, provider);
  return provider;
}

export function activeProvider(): Promise<AiProvider> {
  return getProvider(activeId);
}

export { whichBinary } from "./detect.ts";

/**
 * Which providers are usable on this machine: CLI providers need their binary
 * resolvable; API providers (openrouter) are always offered (the Settings hint
 * covers a missing key). Cheap — call on demand to rescan.
 */
export function availableProviderIds(): ProviderId[] {
  return (Object.keys(LOADERS) as ProviderId[]).filter((id) => {
    const bin = CLI_BINARIES[id];
    return bin ? whichBinary(bin) !== null : true;
  });
}
