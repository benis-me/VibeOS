import { test, expect } from "bun:test";
import { imageId } from "./imageCache.ts";

test("imageId: stable for identical inputs", () => {
  const a = imageId("openai", "gpt-image-2", "16:9", "a red fox in snow");
  const b = imageId("openai", "gpt-image-2", "16:9", "a red fox in snow");
  expect(a).toBe(b);
  expect(a).toMatch(/^[0-9a-f]{32}$/);
});

test("imageId: distinct when any field differs", () => {
  const base = imageId("openai", "gpt-image-2", "16:9", "a red fox");
  expect(base).not.toBe(imageId("openai", "gpt-image-2", "1:1", "a red fox"));
  expect(base).not.toBe(imageId("openai", "gpt-image-2", "16:9", "a blue fox"));
  expect(base).not.toBe(imageId("fal", "fal-ai/flux/schnell", "16:9", "a red fox"));
});
