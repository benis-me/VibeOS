import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio, DEVDOCK_TOKENS, parseColor, skinContrastIssues } from "./contrast.ts";

const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!);

test("parses the token syntaxes skins use and computes WCAG ratios", () => {
  expect(ratio("#000", "#ffffff")).toBeCloseTo(21, 1);
  expect(ratio("rgb(255 255 255)", "oklch(0 0 0)")).toBeCloseTo(21, 1);
  expect(ratio("hsl(0 0% 100%)", "oklab(0 0 0)")).toBeCloseTo(21, 1);
  // The reported custom skin: cream text on its teal accent.
  expect(ratio("#f0e6d2", "#0ac8b9")).toBeCloseTo(1.7, 1);
  expect(parseColor("rgba(0, 0, 0, 0.5)")?.[3]).toBe(0.5);
  expect(parseColor("color-mix(in oklab, red, blue)")).toBeNull();
});

test("checks the pairs a skin touches, filling the other side only when the fallback is known", () => {
  const ok = {
    foreground: "#f0e6d2",
    background: "#010a13",
    accent: "#0ac8b9",
    "accent-foreground": "#010a13",
  };
  expect(skinContrastIssues({ light: ok, dark: ok }, DEVDOCK_TOKENS)).toEqual([]);
  expect(
    skinContrastIssues({ light: { ...ok, "accent-foreground": "#f0e6d2" }, dark: {} }),
  ).toEqual([
    "light: accent-foreground on accent is 1.70:1, needs 4.5:1",
    "dark: accent-foreground on accent is 1.70:1, needs 4.5:1",
  ]);
  // A dark brand on a blank skin keeps DevDock's dark-mode (dark) brand text: unreadable.
  const darkBrand = { light: {}, dark: { brand: "#1d2b4f" } };
  expect(skinContrastIssues(darkBrand, DEVDOCK_TOKENS)).toEqual([
    "dark: brand-foreground on brand is 1.29:1, needs 4.5:1",
  ]);
  expect(skinContrastIssues(darkBrand)).toEqual([]); // unknown foundation: not guessed
  // Dark mode inherits the light tokens it does not override.
  const mixed = { light: ok, dark: { "accent-foreground": "#f0e6d2" } };
  expect(skinContrastIssues(mixed, DEVDOCK_TOKENS)).toEqual([
    "dark: accent-foreground on accent is 1.70:1, needs 4.5:1",
  ]);
  expect(skinContrastIssues({ light: { card: "var(--background)" }, dark: {} })).toEqual([]);
});

test("the DevDock fallback mirrors the CSS defaults", () => {
  const css = readFileSync(
    new URL("../../../frontend/src/styles/globals.css", import.meta.url),
    "utf8",
  );
  for (const [mode, selector] of [
    ["light", ":root {"],
    ["dark", ".dark {"],
  ] as const) {
    const block = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
    for (const [token, value] of Object.entries(DEVDOCK_TOKENS[mode]))
      expect(block).toContain(`--${token}: ${value};`);
  }
});
