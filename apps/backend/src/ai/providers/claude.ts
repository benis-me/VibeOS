import { AnthropicCliProvider } from "./cli/AnthropicCliProvider.ts";

/**
 * Claude Code — drives the `claude` CLI directly in headless stream-json mode.
 * Auth reuses the CLI login or ANTHROPIC_API_KEY. The CLI exposes no model-list
 * command, so we offer its stable aliases (they resolve to the latest model).
 */
export const claudeProvider = new AnthropicCliProvider({
  id: "claude",
  label: "Claude Code",
  bin: "claude",
  fallbackModels: [
    { modelId: "default", name: "Default (CLI config)" },
    { modelId: "opus", name: "Opus" },
    { modelId: "sonnet", name: "Sonnet" },
    { modelId: "haiku", name: "Haiku" },
  ],
});
