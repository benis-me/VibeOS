import { AnthropicCliProvider } from "./cli/AnthropicCliProvider.ts";

/**
 * CodeBuddy — a Claude-Code fork, so the `codebuddy` CLI speaks the same headless
 * stream-json protocol and reuses {@link AnthropicCliProvider}. Auth reuses the
 * `codebuddy` CLI login or CODEBUDDY_API_KEY. No model-list command → "auto".
 */
export const codebuddyProvider = new AnthropicCliProvider({
  id: "codebuddy",
  label: "CodeBuddy",
  bin: "codebuddy",
  // Current CodeBuddy (2.109+) no longer lists models in `--help`; its account
  // model list lives only behind the interactive `/model list` TUI. The default
  // set is pre-seeded in the shared catalog; "Fetch models" scrapes the live list
  // via a PTY (slow, user-triggered only — see discoverModelsLive).
  liveModelList: true,
});
