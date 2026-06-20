import type {
  AgentRole,
  ModelPolicyOverrides,
  ProviderId,
  RoleConfig,
  ThinkingMode,
} from "@vibeos/shared/domain";
import { activeProvider, activeProviderId } from "./providers/index.ts";
import type { DiscoveredModel, ThinkingConfig } from "./providers/types.ts";
import { env } from "../config/env.ts";

export type { DiscoveredModel, ThinkingConfig };

export interface RoleModelConfig {
  /** Source provider for this role (CLI or API). */
  providerId?: ProviderId;
  model?: string;
  fallbackModel?: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  thinking?: ThinkingConfig;
}

// Heuristics for picking from discovered model ids.
const STRONG_HINTS = ["opus", "pro", "max", "ultra", "4.5", "4.8", "405b", "large"];
const FAST_HINTS = ["flash", "mini", "haiku", "lite", "fast", "small", "turbo", "air"];

// Defaults per role when the user hasn't overridden anything. Realtime UI
// generation and the ambient/maintenance daemons all default to NO thinking
// for snappy, direct output.
const DEFAULTS: Record<AgentRole, { effort: RoleModelConfig["effort"]; thinking: ThinkingMode }> = {
  "ui-generation": { effort: "medium", thinking: "disabled" },
  "system-event": { effort: "low", thinking: "disabled" },
  maintenance: { effort: "low", thinking: "disabled" },
  // Image generation doesn't use ModelPolicy (it reads prefs.imageModel); this
  // entry only keeps the record total for the AgentRole union.
  "image-generation": { effort: "low", thinking: "disabled" },
};

class ModelPolicyImpl {
  private models: DiscoveredModel[] = [];
  private overrides: ModelPolicyOverrides = {};
  private roleConfig: Record<AgentRole, RoleModelConfig> = {
    "ui-generation": { effort: "medium", thinking: { type: "disabled" } },
    "system-event": { effort: "low", thinking: { type: "disabled" } },
    maintenance: { effort: "low", thinking: { type: "disabled" } },
    "image-generation": { effort: "low", thinking: { type: "disabled" } },
  };

  async discover(overrides: ModelPolicyOverrides = {}): Promise<void> {
    const provider = await activeProvider();
    this.models = await provider.discoverModels();
    this.recompute(overrides);
    console.log(
      `[models] discovered ${this.models.length} model(s); ui=${this.roleConfig["ui-generation"].model ?? "(default)"} fast=${this.roleConfig["system-event"].model ?? "(default)"}`,
    );
  }

  recompute(overrides: ModelPolicyOverrides = {}): void {
    this.overrides = overrides;
    const ids = this.models.map((m) => m.modelId);
    const strong = pick(ids, STRONG_HINTS) ?? ids[0];
    const fast = pick(ids, FAST_HINTS) ?? strong ?? ids[0];

    const auto: Record<AgentRole, string | undefined> = {
      "ui-generation": strong,
      "system-event": fast,
      maintenance: fast,
      "image-generation": undefined,
    };
    const envOverride: Record<AgentRole, string | undefined> = {
      "ui-generation": env.modelUiOverride,
      "system-event": env.modelFastOverride,
      maintenance: env.modelFastOverride,
      "image-generation": undefined,
    };
    const fallback: Record<AgentRole, string | undefined> = {
      "ui-generation": fast,
      "system-event": strong,
      maintenance: strong,
      "image-generation": undefined,
    };

    const next = {} as Record<AgentRole, RoleModelConfig>;
    for (const role of Object.keys(DEFAULTS) as AgentRole[]) {
      const o: RoleConfig = overrides[role] ?? {};
      const modelChoice = resolve(o.model || envOverride[role], ids) ?? auto[role];
      // The SDK rejects a fallback that equals the main model — drop it then.
      const fb = fallback[role] && fallback[role] !== modelChoice ? fallback[role] : undefined;
      next[role] = {
        model: modelChoice,
        fallbackModel: fb,
        effort: o.effort ?? DEFAULTS[role].effort,
        thinking: toThinking(o.thinking ?? DEFAULTS[role].thinking, o.thinkingBudget),
      };
    }
    this.roleConfig = next;
  }

  for(role: AgentRole): RoleModelConfig {
    const defaultProvider = activeProviderId();
    const o: RoleConfig = this.overrides[role] ?? {};
    const providerId = (o.provider as ProviderId) || defaultProvider;
    // An explicit non-default provider bypasses the default-provider auto-pick:
    // honor the user's exact model choice for that provider (its own model list
    // isn't what `recompute` indexed).
    if (o.provider && o.provider !== defaultProvider) {
      return {
        providerId,
        model: o.model || undefined,
        fallbackModel: undefined,
        effort: o.effort ?? DEFAULTS[role].effort,
        thinking: toThinking(o.thinking ?? DEFAULTS[role].thinking, o.thinkingBudget),
      };
    }
    return { providerId, ...this.roleConfig[role] };
  }

  /** Discovered models, for surfacing in Settings. */
  available(): DiscoveredModel[] {
    return this.models;
  }

  /** Effective per-role config (merged defaults + overrides) for display. */
  effective(): Record<AgentRole, RoleModelConfig> {
    return this.roleConfig;
  }
}

function toThinking(mode: ThinkingMode, budget?: number): ThinkingConfig {
  if (mode === "enabled") return { type: "enabled", budgetTokens: budget ?? 4000 };
  if (mode === "adaptive") return { type: "adaptive" };
  return { type: "disabled" };
}

function pick(ids: string[], hints: string[]): string | undefined {
  for (const hint of hints) {
    const hit = ids.find((id) => id.toLowerCase().includes(hint));
    if (hit) return hit;
  }
  return undefined;
}

/** Resolve an override (exact id or substring) against discovered ids. */
function resolve(override: string | undefined, ids: string[]): string | undefined {
  if (!override) return undefined;
  if (ids.includes(override)) return override;
  const hit = ids.find((id) => id.toLowerCase().includes(override.toLowerCase()));
  return hit ?? override; // pass through even if not discovered
}

export const ModelPolicy = new ModelPolicyImpl();
