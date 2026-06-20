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

export type AgentRole = "ui-generation" | "system-event" | "maintenance" | "image-generation";

/**
 * The AI backend driving generation. `codebuddy`/`claude`/`codex` spawn a local
 * CLI subprocess (the "Local Agents"); the rest talk to a hosted HTTP API (the
 * "API Providers") via the Vercel AI SDK using a key configured in Settings.
 */
export type ProviderId =
  | "codebuddy"
  | "claude"
  | "codex"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "fal";

/** A provider's transport, surfaced in Settings so the UI can hint at setup. */
export type ProviderKind = "cli" | "api";

/** A capability flag shown as a chip next to a model and used to filter pickers. */
export type ModelCapability = "text" | "vision" | "image" | "reasoning" | "tools";

/** A model offered by a provider (seeded from the catalog, refreshable live). */
export interface ProviderModel {
  id: string;
  name: string;
  capabilities?: ModelCapability[];
  /** Shown/usable in pickers. Defaults to true. */
  enabled?: boolean;
}

/** Which credential inputs an API provider renders in Settings. */
export type ProviderField = "apiKey" | "baseUrl";

/** Per-API-provider configuration (key + base url + model list), stored in DB. */
export interface ApiProviderConfig {
  /** Defaults to true (treat `!== false` as enabled). */
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  /** Seeded from the catalog, refreshable via "Fetch models". */
  models?: ProviderModel[];
  /** Provider-specific extras (e.g. OpenRouter HTTP-Referer / X-Title). */
  extra?: Record<string, string>;
}

export interface ProviderCatalogEntry {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  defaultBaseUrl?: string;
  /** Credential inputs to render (API providers only). */
  fields?: ProviderField[];
  /** Provider exposes a models endpoint for live "Fetch models". */
  modelsEndpoint?: boolean;
  /** Can drive the text roles (ui-generation, …). */
  textCapable?: boolean;
  /** Can serve the image-generation role. */
  imageCapable?: boolean;
  /** Verified default model list (June 2026). Refreshable at runtime. */
  seedModels?: ProviderModel[];
}

const TEXT: ModelCapability[] = ["text", "vision", "reasoning"];
const IMG: ModelCapability[] = ["image"];

/** Static provider catalog: Local Agents (CLI) + API Providers. */
export const AI_PROVIDERS: readonly ProviderCatalogEntry[] = [
  // — Local Agents (CLI subprocess; no key, configured via their own login) —
  {
    id: "codebuddy",
    label: "CodeBuddy",
    kind: "cli",
    textCapable: true,
    // CodeBuddy's CLI has a built-in ImageGen tool (text-to-image).
    imageCapable: true,
    seedModels: [{ id: "default", name: "ImageGen", capabilities: IMG }],
  },
  { id: "claude", label: "Claude Code", kind: "cli", textCapable: true },
  { id: "codex", label: "Codex", kind: "cli", textCapable: true },
  // — API Providers (hosted, key configured in Settings) —
  {
    id: "openai",
    label: "OpenAI",
    kind: "api",
    defaultBaseUrl: "https://api.openai.com/v1",
    fields: ["apiKey", "baseUrl"],
    modelsEndpoint: true,
    textCapable: true,
    imageCapable: true,
    seedModels: [
      { id: "gpt-5.5", name: "GPT-5.5", capabilities: TEXT },
      { id: "gpt-5.4", name: "GPT-5.4", capabilities: TEXT },
      { id: "gpt-5.4-mini", name: "GPT-5.4 mini", capabilities: TEXT },
      { id: "gpt-5.4-nano", name: "GPT-5.4 nano", capabilities: TEXT },
      { id: "gpt-image-2", name: "GPT Image 2", capabilities: IMG },
      { id: "gpt-image-1.5", name: "GPT Image 1.5", capabilities: IMG },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "api",
    defaultBaseUrl: "https://api.anthropic.com",
    fields: ["apiKey", "baseUrl"],
    modelsEndpoint: true,
    textCapable: true,
    imageCapable: false,
    seedModels: [
      { id: "claude-opus-4-8", name: "Claude Opus 4.8", capabilities: TEXT },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", capabilities: TEXT },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", capabilities: TEXT },
      { id: "claude-fable-5", name: "Claude Fable 5", capabilities: TEXT },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    kind: "api",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    fields: ["apiKey", "baseUrl"],
    modelsEndpoint: true,
    textCapable: true,
    imageCapable: true,
    seedModels: [
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", capabilities: TEXT },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", capabilities: TEXT },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", capabilities: TEXT },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", capabilities: TEXT },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", capabilities: TEXT },
      { id: "gemini-3-pro-image", name: "Gemini 3 Pro Image", capabilities: IMG },
      { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", capabilities: IMG },
      { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image", capabilities: IMG },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "api",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    fields: ["apiKey", "baseUrl"],
    modelsEndpoint: true,
    textCapable: true,
    imageCapable: true,
    seedModels: [
      { id: "openai/gpt-5.5", name: "OpenAI: GPT-5.5", capabilities: TEXT },
      { id: "anthropic/claude-opus-4-8", name: "Anthropic: Claude Opus 4.8", capabilities: TEXT },
      { id: "google/gemini-3.5-flash", name: "Google: Gemini 3.5 Flash", capabilities: TEXT },
      { id: "google/gemini-2.5-flash-image", name: "Google: Gemini 2.5 Flash Image", capabilities: IMG },
    ],
  },
  {
    id: "fal",
    label: "Fal",
    kind: "api",
    defaultBaseUrl: "https://fal.run",
    fields: ["apiKey"],
    modelsEndpoint: true,
    textCapable: false,
    imageCapable: true,
    seedModels: [
      { id: "fal-ai/flux/schnell", name: "FLUX.1 [schnell]", capabilities: IMG },
      { id: "fal-ai/flux/dev", name: "FLUX.1 [dev]", capabilities: IMG },
      { id: "fal-ai/flux-2-pro", name: "FLUX.2 [pro]", capabilities: IMG },
      { id: "fal-ai/nano-banana-pro", name: "Nano Banana Pro", capabilities: IMG },
      { id: "fal-ai/qwen-image", name: "Qwen-Image", capabilities: IMG },
      { id: "fal-ai/ideogram/v3", name: "Ideogram V3", capabilities: IMG },
      { id: "fal-ai/recraft-v3", name: "Recraft V3", capabilities: IMG },
    ],
  },
];

export const DEFAULT_PROVIDER: ProviderId = "claude";

export type Effort = "low" | "medium" | "high" | "xhigh";
export type ThinkingMode = "disabled" | "adaptive" | "enabled";

/** Per-task-type model + reasoning configuration. */
export interface RoleConfig {
  /** Source provider (CLI id or API provider id). Empty = the default engine ({@link Settings.provider}). */
  provider?: string;
  /** Model id (exact) or substring matched against discovered ids. Empty = auto. */
  model?: string;
  effort?: Effort;
  thinking?: ThinkingMode;
  /** Token budget when thinking === 'enabled'. */
  thinkingBudget?: number;
}

export type ModelPolicyOverrides = Partial<Record<AgentRole, RoleConfig>>;

/** Which provider+model generates images for UIs (Default Models page). */
export interface ImageModelRef {
  provider?: string;
  model?: string;
}

export interface Preferences {
  /** Disable proactive system-event agent. */
  proactiveAgents?: boolean;
  /** Wallpaper identifier. */
  wallpaper?: string;
  /** Model used for in-UI image generation. */
  imageModel?: ImageModelRef;
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
  /** Per-API-provider config (key + base url + models), keyed by provider id. */
  apiProviders: Record<string, ApiProviderConfig>;
  prefs: Preferences;
  updatedAt: number;
}
