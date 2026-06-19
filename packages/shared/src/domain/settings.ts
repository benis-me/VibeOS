export type Theme = "light" | "dark";

/** Visual skin / design language. Orthogonal to {@link Theme} (light/dark). */
export type Skin = "devdock" | "xp" | "aqua";

export const DEFAULT_SKIN: Skin = "devdock";

export const SKINS: readonly { id: Skin; label: string }[] = [
  { id: "devdock", label: "DevDock" },
  { id: "xp", label: "Windows XP" },
  { id: "aqua", label: "Mac Aqua" },
];

/** UI + generated-content language. */
export type Locale = "zh" | "en";

export const DEFAULT_LOCALE: Locale = "zh";

export type AgentRole = "ui-generation" | "system-event" | "maintenance";

/**
 * The AI backend driving generation. The first three spawn a local CLI
 * subprocess; `openrouter` talks to an OpenAI-compatible HTTP API (OpenRouter
 * by default) via the Vercel AI SDK. CodeBuddy is the default.
 */
export type ProviderId = "codebuddy" | "claude" | "codex" | "openrouter";

/** A provider's transport, surfaced in Settings so the UI can hint at setup. */
export type ProviderKind = "cli" | "api";

/** Static provider catalog, used by the Settings provider picker. */
export const AI_PROVIDERS: readonly {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
}[] = [
  { id: "codebuddy", label: "CodeBuddy", kind: "cli" },
  { id: "claude", label: "Claude Code", kind: "cli" },
  { id: "codex", label: "Codex", kind: "cli" },
  { id: "openrouter", label: "OpenRouter", kind: "api" },
];

export const DEFAULT_PROVIDER: ProviderId = "claude";

export type Effort = "low" | "medium" | "high" | "xhigh";
export type ThinkingMode = "disabled" | "adaptive" | "enabled";

/** Per-task-type model + reasoning configuration. */
export interface RoleConfig {
  /** Model id (exact) or substring matched against discovered ids. Empty = auto. */
  model?: string;
  effort?: Effort;
  thinking?: ThinkingMode;
  /** Token budget when thinking === 'enabled'. */
  thinkingBudget?: number;
}

export type ModelPolicyOverrides = Partial<Record<AgentRole, RoleConfig>>;

export interface Preferences {
  /** Disable proactive system-event agent. */
  proactiveAgents?: boolean;
  /** Wallpaper identifier. */
  wallpaper?: string;
  [key: string]: unknown;
}

export interface Settings {
  theme: Theme;
  /** Visual skin / design language (separate from light/dark). */
  skin?: Skin;
  /** Active AI backend. Falls back to the env default, then CodeBuddy. */
  provider: ProviderId;
  /**
   * UI + generated-content language. Undefined means "not chosen yet" — the
   * frontend follows the browser (falling back to {@link DEFAULT_LOCALE}) and
   * persists its choice on first boot.
   */
  locale?: Locale;
  /**
   * Free-text profile the user writes about themselves (name, preferences,
   * recurring projects). Injected into every generation so hallucinated apps
   * feel personalized and coherent across windows.
   */
  userProfile?: string;
  modelOverrides: ModelPolicyOverrides;
  prefs: Preferences;
  updatedAt: number;
}
