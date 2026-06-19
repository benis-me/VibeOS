/**
 * Approximate public list prices (USD per 1M tokens), used to ESTIMATE cost when
 * a provider reports token counts but not a dollar figure — i.e. everything
 * except the Claude CLI (codebuddy, codex, openrouter all omit cost). Matched by
 * substring on the model id, most specific patterns first. Estimates only; the
 * Claude CLI's reported `total_cost_usd` is always preferred when present.
 */
const PRICES: { match: RegExp; in: number; out: number }[] = [
  // OpenAI GPT-5.x (specific tiers before the generic gpt-5 fallback)
  { match: /gpt-?5\.5/, in: 5, out: 30 },
  { match: /gpt-?5\.4-?nano/, in: 0.2, out: 1.25 },
  { match: /gpt-?5\.4-?mini/, in: 0.75, out: 4.5 },
  { match: /gpt-?5\.4/, in: 2.5, out: 15 },
  { match: /(gpt-?4o|gpt-?4\.1|gpt-?5|o3|o4)-?mini|o1-mini/, in: 0.15, out: 0.6 },
  { match: /gpt-?4o|gpt-?4\.1|gpt-?5|chatgpt/, in: 2.5, out: 10 },
  { match: /o3|o1/, in: 15, out: 60 },
  // Anthropic — current gen (Opus 4.5–4.8 = 5/25; Fable 5 = 10/50)
  { match: /fable/, in: 10, out: 50 },
  { match: /opus-?4|claude-opus-4/, in: 5, out: 25 },
  { match: /opus/, in: 15, out: 75 },
  { match: /sonnet/, in: 3, out: 15 },
  { match: /haiku/, in: 1, out: 5 },
  // Gemini — specific families before the generic fallbacks
  { match: /gemini-?3.*flash-?lite/, in: 0.25, out: 1.5 },
  { match: /gemini-?3\.5-flash/, in: 1.5, out: 9 },
  { match: /gemini-?3.*pro/, in: 2, out: 12 },
  { match: /gemini-?2\.5-pro/, in: 1.25, out: 10 },
  { match: /gemini-?2\.5-flash-?lite/, in: 0.1, out: 0.4 },
  { match: /flash/, in: 0.3, out: 2.5 },
  { match: /gemini/, in: 1.25, out: 5 },
  { match: /deepseek/, in: 0.27, out: 1.1 },
  { match: /qwen|glm|kimi|moonshot|ernie|doubao|hunyuan|minimax/, in: 0.5, out: 1.5 },
];

/**
 * Estimate the dollar cost of a run from its token usage. Returns undefined when
 * the model is unknown or no tokens were reported (caller leaves cost blank).
 */
export function estimateCostUsd(
  model: string | undefined,
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  if (!model || (!inputTokens && !outputTokens)) return undefined;
  const id = model.toLowerCase();
  const p = PRICES.find((x) => x.match.test(id));
  if (!p) return undefined;
  return ((inputTokens ?? 0) * p.in + (outputTokens ?? 0) * p.out) / 1_000_000;
}
