/**
 * Approximate public list prices (USD per 1M tokens), used to ESTIMATE cost when
 * a provider reports token counts but not a dollar figure — i.e. everything
 * except the Claude CLI (codebuddy, codex, openrouter all omit cost). Matched by
 * substring on the model id, most specific patterns first. Estimates only; the
 * Claude CLI's reported `total_cost_usd` is always preferred when present.
 */
const PRICES: { match: RegExp; in: number; out: number }[] = [
  { match: /opus/, in: 15, out: 75 },
  { match: /sonnet/, in: 3, out: 15 },
  { match: /haiku/, in: 0.8, out: 4 },
  { match: /(gpt-?4o|gpt-?4\.1|gpt-?5|o3|o4)-?mini|o1-mini/, in: 0.15, out: 0.6 },
  { match: /gpt-?4o|gpt-?4\.1|gpt-?5|chatgpt/, in: 2.5, out: 10 },
  { match: /o3|o1/, in: 15, out: 60 },
  { match: /flash/, in: 0.075, out: 0.3 },
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
