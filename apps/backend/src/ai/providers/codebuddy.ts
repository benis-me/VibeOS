import { AnthropicCliProvider } from "./cli/AnthropicCliProvider.ts";

/**
 * CodeBuddy — a Claude-Code fork, so the `codebuddy` CLI speaks the same headless
 * stream-json protocol and reuses {@link AnthropicCliProvider}. Auth reuses the
 * `codebuddy` CLI login or CODEBUDDY_API_KEY. Its account model list comes from
 * the same `initialize` reply; the shared catalog stands in until it answers.
 */
export const codebuddyProvider = new AnthropicCliProvider({
  id: "codebuddy",
  label: "CodeBuddy",
  bin: "codebuddy",
});
