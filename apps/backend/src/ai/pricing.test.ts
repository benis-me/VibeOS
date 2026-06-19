import { test, expect } from "bun:test";
import { estimateCostUsd } from "./pricing.ts";

// Input-only cost over exactly 1M tokens equals the model's per-1M input price.
const inRate = (m: string) => estimateCostUsd(m, 1_000_000, 0);

test("estimateCostUsd: token math (in + out)", () => {
  // Opus 4.x = $5 in / $25 out per 1M.
  expect(estimateCostUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(30, 5);
  expect(estimateCostUsd("gpt-5.4-mini", 2_000_000, 1_000_000)).toBeCloseTo(2 * 0.75 + 4.5, 5);
});

test("estimateCostUsd: current model tiers", () => {
  expect(inRate("gpt-5.5")).toBeCloseTo(5);
  expect(inRate("gpt-5.4")).toBeCloseTo(2.5);
  expect(inRate("gpt-5.4-mini")).toBeCloseTo(0.75);
  expect(inRate("gpt-5.4-nano")).toBeCloseTo(0.2);
  expect(inRate("claude-opus-4-8")).toBeCloseTo(5);
  expect(inRate("claude-fable-5")).toBeCloseTo(10);
  expect(inRate("claude-sonnet-4-6")).toBeCloseTo(3);
  expect(inRate("claude-haiku-4-5")).toBeCloseTo(1);
  expect(inRate("gemini-3.5-flash")).toBeCloseTo(1.5);
  expect(inRate("gemini-3.1-pro-preview")).toBeCloseTo(2);
  expect(inRate("gemini-3.1-flash-lite")).toBeCloseTo(0.25);
  expect(inRate("gemini-2.5-pro")).toBeCloseTo(1.25);
  expect(inRate("gemini-2.5-flash")).toBeCloseTo(0.3);
});

test("estimateCostUsd: unknown model or no tokens → undefined", () => {
  expect(estimateCostUsd("totally-unknown-xyz", 100, 100)).toBeUndefined();
  expect(estimateCostUsd("gpt-5.5", 0, 0)).toBeUndefined();
  expect(estimateCostUsd(undefined, 100, 100)).toBeUndefined();
});
