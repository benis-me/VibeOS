/**
 * WCAG contrast for the CSS colors a skin token may hold (hex, rgb, hsl, oklch,
 * oklab, transparent). Anything else (var(), color-mix(), names) is unknown and
 * skipped rather than guessed.
 */
type Rgba = [number, number, number, number]; // gamma-encoded sRGB 0..1, alpha 0..1

const num = (s: string, scale = 1) =>
  s.endsWith("%") ? (Number.parseFloat(s) / 100) * scale : Number.parseFloat(s);
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) =>
  clamp(c) <= 0.0031308 ? 12.92 * clamp(c) : 1.055 * clamp(c) ** (1 / 2.4) - 0.055;

function oklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

export function parseColor(input: string): Rgba | null {
  const v = input.trim().toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)?.[1];
  if (hex) {
    const h = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const fn = /^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/.exec(v);
  if (!fn) return null;
  const [main = "", slash] = fn[2]!.split("/");
  const parts = main
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const alphaText = slash?.trim() ?? (parts.length === 4 ? parts.pop() : undefined);
  const alpha = alphaText === undefined ? 1 : clamp(num(alphaText));
  const [x = "", y = "", z = ""] = parts;
  if (
    parts.length !== 3 ||
    [x, y, z, String(alpha)].some((p) => Number.isNaN(Number.parseFloat(p)))
  )
    return null;
  const kind = fn[1]!;
  const rgb: [number, number, number] = kind.startsWith("rgb")
    ? [num(x, 255) / 255, num(y, 255) / 255, num(z, 255) / 255]
    : kind.startsWith("hsl")
      ? hsl(Number.parseFloat(x), num(y), num(z))
      : kind === "oklch"
        ? oklab(
            num(x),
            num(y, 0.4) * Math.cos((Number.parseFloat(z) * Math.PI) / 180),
            num(y, 0.4) * Math.sin((Number.parseFloat(z) * Math.PI) / 180),
          )
        : oklab(num(x), num(y, 0.4), num(z, 0.4));
  return [clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2]), alpha];
}

/** `top` painted over an opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
  1,
];
const luminance = ([r, g, b]: Rgba) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text tokens and the fill they sit on; both modes must keep each pair readable. */
const PAIRS = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["accent-foreground", "accent"],
  ["brand-foreground", "brand"],
] as const;

type Tokens = Partial<Record<string, string>>;

/** What a blank skin falls back to: DevDock's :root / .dark values in globals.css. */
export const DEVDOCK_TOKENS: { light: Tokens; dark: Tokens } = {
  light: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.145 0 0)",
    accent: "oklch(0.97 0 0)",
    "accent-foreground": "oklch(0.205 0 0)",
    brand: "oklch(0.28 0 0)",
    "brand-foreground": "oklch(0.985 0 0)",
  },
  dark: {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    card: "oklch(0.205 0 0)",
    "card-foreground": "oklch(0.985 0 0)",
    accent: "oklch(0.269 0 0)",
    "accent-foreground": "oklch(0.985 0 0)",
    brand: "oklch(0.92 0 0)",
    "brand-foreground": "oklch(0.205 0 0)",
  },
};

/**
 * Problems in the pairs a skin touches, in words the generating model can fix.
 * A side the skin leaves out uses `fallback`; without one (unknown foundation)
 * a half-defined pair is skipped rather than guessed.
 */
export function skinContrastIssues(
  definition: { light: Tokens; dark: Tokens },
  fallback?: { light: Tokens; dark: Tokens },
): string[] {
  const issues: string[] = [];
  for (const mode of ["light", "dark"] as const) {
    // Dark mode layers the skin's dark tokens over its light ones, as compileSkin does.
    const own = mode === "dark" ? { ...definition.light, ...definition.dark } : definition.light;
    const tokens = { ...fallback?.[mode], ...own };
    const page = parseColor(tokens.background ?? "");
    for (const [fgKey, bgKey] of PAIRS) {
      if (own[fgKey] === undefined && own[bgKey] === undefined) continue;
      const [fgValue, bgValue] = [tokens[fgKey], tokens[bgKey]];
      if (fgValue === undefined || bgValue === undefined) continue;
      let bg = parseColor(bgValue);
      const fg = parseColor(fgValue);
      if (!bg || !fg) continue;
      if (bg[3] < 1) {
        if (!page || page[3] < 1 || bgKey === "background") continue;
        bg = over(bg, page);
      }
      const ratio = contrastRatio(over(fg, bg), bg);
      if (ratio < 4.5)
        issues.push(`${mode}: ${fgKey} on ${bgKey} is ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
  return issues;
}
