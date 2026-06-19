import { resolve } from "node:path";
import type { ProviderId } from "@vibeos/shared/domain";

function num(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function providerId(value: string | undefined): ProviderId | undefined {
  return value === "codebuddy" || value === "claude" || value === "codex" || value === "openrouter"
    ? value
    : undefined;
}

export const env = {
  port: num(process.env.PORT, 7720),
  dbPath: resolve(process.env.VIBEOS_DB_PATH ?? "./data/vibeos.db"),
  modelUiOverride: process.env.VIBEOS_MODEL_UI,
  modelFastOverride: process.env.VIBEOS_MODEL_FAST,
  /** Default AI backend at boot, before any Settings override. */
  aiProvider: providerId(process.env.VIBEOS_AI_PROVIDER),
  /** OpenAI-compatible endpoint for the `openrouter` provider. */
  aiBaseUrl: process.env.VIBEOS_AI_BASE_URL ?? "https://openrouter.ai/api/v1",
  /** API key for the `openrouter` provider (OpenRouter or any compatible API). */
  aiApiKey:
    process.env.OPENROUTER_API_KEY ?? process.env.VIBEOS_AI_API_KEY ?? process.env.OPENAI_API_KEY,
  /** Abort a single generation if it produces nothing for this long (hang guard). */
  genTimeoutMs: num(process.env.VIBEOS_GEN_TIMEOUT_MS, 180_000),
  /**
   * Optional cap on the current-UI HTML fed back as context. UI generation is
   * stateless (fresh context per op), so the full snapshot is sent every time by
   * default (0 = no cap). Set VIBEOS_SNAPSHOT_BUDGET > 0 only to bound very large
   * apps at the cost of the model seeing less of the existing structure.
   */
  snapshotBudget: num(process.env.VIBEOS_SNAPSHOT_BUDGET, 0),
  /** Disable real SDK calls (offline/dev) — returns stub HTML instead. */
  aiStub: process.env.VIBEOS_AI_STUB === "1",
  /** Disable proactive timer agents (useful in dev). */
  agentsDisabled: process.env.VIBEOS_AGENTS_DISABLED === "1",
} as const;
