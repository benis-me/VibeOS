import type { Effort, ProviderId } from "@vibeos/shared/domain";

export type { ProviderId };

/** A model the active provider can serve, for the Settings model picker. */
export interface DiscoveredModel {
  modelId: string;
  name: string;
  description?: string;
}

export type ThinkingConfig =
  | { type: "disabled" }
  | { type: "adaptive" }
  | { type: "enabled"; budgetTokens: number };

/**
 * A resolved, provider-facing request: the {@link ModelPolicy} has already
 * picked the model/effort/thinking and the system prompt is final. Providers
 * only translate this into their backend's call.
 */
export interface ProviderRunOptions {
  prompt: string;
  /** Final system prompt (role default or override, plus locale directive). */
  systemPrompt: string;
  model?: string;
  fallbackModel?: string;
  effort?: Effort;
  thinking?: ThinkingConfig;
  /**
   * Resume a prior conversation, when a caller wants continuity. The value is a
   * provider-native id. UI generation runs stateless (never sets this); the seam
   * still supports it for other/future callers. API providers without sessions
   * ignore it.
   */
  sessionId?: string;
  /** Incremental visible-text callback for live streaming. */
  onDelta?: (text: string) => void;
  abort?: AbortController;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface RunResult {
  text: string;
  /** Provider-native session id, if the provider supports resumable sessions. */
  sessionId?: string;
  ok: boolean;
  /** Failure detail, recorded against the agent run. */
  error?: string;
  /** Token usage + cost when the provider reports it (for the Activity Monitor). */
  usage?: TokenUsage;
  /** Agent-run id, so callers can attach a summary of what was produced. */
  runId?: string;
}

/**
 * One AI backend. The OS depends only on this seam, so swapping CodeBuddy for
 * Claude Code, Codex, or an HTTP API never touches the agents, prompt
 * assembler, or frontend.
 */
export interface AiProvider {
  readonly id: ProviderId;
  readonly label: string;
  run(opts: ProviderRunOptions): Promise<RunResult>;
  /** Best-effort model list for Settings; returns [] if it can't enumerate. */
  discoverModels(): Promise<DiscoveredModel[]>;
  /**
   * Heavyweight, user-triggered discovery for providers whose model list can't
   * be read cheaply (e.g. a CLI that only lists models in its interactive TUI,
   * scraped via a PTY). Only called from the explicit "Fetch models" action —
   * never on boot/scan. Falls back to {@link discoverModels} when absent.
   */
  discoverModelsLive?(): Promise<DiscoveredModel[]>;
}
