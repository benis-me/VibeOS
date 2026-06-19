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
  // The codebuddy CLI lists its models in `--help` (Currently supported: (…)).
  discoverViaHelp: true,
});
