import { z } from "zod";

export const BUILTIN_SKIN_IDS = ["devdock", "xp", "aqua"] as const;
export type BuiltinSkin = (typeof BUILTIN_SKIN_IDS)[number];
export type Skin = BuiltinSkin | `skin-${string}`;
export const skinIdSchema = z.union([
  z.enum(BUILTIN_SKIN_IDS),
  z.string().regex(/^skin-[0-9A-HJKMNP-TV-Z]{26}$/),
]);
export const isBuiltinSkin = (id: string): id is BuiltinSkin =>
  (BUILTIN_SKIN_IDS as readonly string[]).includes(id);

export const SKIN_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "brand",
  "brand-foreground",
  "run",
  "warn",
  "idle",
  "sheen",
  "desktop",
  "window-titlebar",
  "radius",
  "taskbar-h",
  "font-sans",
  "font-title",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

/** Own chrome hooks, never model-supplied selectors or executable stylesheets. */
export const SKIN_TARGETS = {
  window: [".vibe-window"],
  titlebar: [".vibe-titlebar"],
  title: [".vibe-title"],
  windowBody: [".vibe-window-body"],
  windowButton: [".vibe-winbtn"],
  closeButton: [".vibe-winbtn-close"],
  minimizeButton: [".vibe-winbtn-min"],
  maximizeButton: [".vibe-winbtn-max"],
  taskbar: [".vibe-taskbar"],
  startButton: [".vibe-startbtn"],
  task: [".vibe-taskitem"],
  menu: [".vibe-menu"],
  menuItem: [".vibe-menu-item"],
  button: [".vibe-btn", ".ai-surface button", ".ai-surface [role=button]"],
  input: [".vibe-input", ".ai-surface input", ".ai-surface textarea", ".ai-surface select"],
  addressbar: [".vibe-files-addressbar"],
  location: [".vibe-files-location"],
  desktop: [".vibe-desktop"],
  startMenu: [".vibe-startmenu"],
  tray: [".vibe-tray-area"],
} as const;
export const SKIN_PROPERTIES = [
  "color",
  "background",
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "background-blend-mode",
  "background-origin",
  "background-clip",
  "border",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "border-image-source",
  "border-image-slice",
  "border-image-width",
  "border-image-repeat",
  "box-shadow",
  "text-shadow",
  "backdrop-filter",
  "font-family",
  "font-weight",
  "font-size",
  "font-style",
  "text-transform",
  "letter-spacing",
  "outline-color",
  "outline-style",
  "outline-width",
  "outline-offset",
] as const;
const functions = new Set([
  "var",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "oklch",
  "oklab",
  "color-mix",
  "linear-gradient",
  "radial-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "conic-gradient",
  "asset",
  "blur",
  "saturate",
]);
/** No URLs, escapes, comments, at-rules, arbitrary variables or declaration breakout. */
const cssValue = z
  .string()
  .trim()
  .min(1)
  .max(2400)
  .superRefine((value, ctx) => {
    const bad = () =>
      ctx.addIssue({
        code: "custom",
        message: "Use safe CSS appearance values and VibeOS tokens only",
      });
    if (!/^[a-zA-Z0-9#.,%()\s/+'"_-]+$/.test(value)) return bad();
    for (const match of value.matchAll(/([a-z-]+)\s*\(/gi))
      if (!functions.has(match[1]!.toLowerCase())) return bad();
    for (const match of value.matchAll(/--[a-z0-9-]+/gi))
      if (!(SKIN_TOKENS as readonly string[]).includes(match[0].slice(2))) return bad();
    let depth = 0;
    for (const char of value) {
      if (char === "(") depth++;
      if (char === ")" && --depth < 0) return bad();
    }
    if (depth !== 0 || /(?:url|expression|javascript|!important)/i.test(value)) bad();
  });
const tokens = z.partialRecord(z.enum(SKIN_TOKENS), cssValue).superRefine((values, ctx) => {
  for (const key of ["radius", "taskbar-h"] as const) {
    const value = values[key];
    if (value === undefined) continue;
    const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value);
    const px = match ? Number(match[1]) * (match[2] === "rem" ? 16 : 1) : NaN;
    if (!Number.isFinite(px) || (key === "radius" ? px < 0 || px > 32 : px < 28 || px > 72))
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: key === "radius" ? "Radius must be 0–32px" : "Taskbar must be 28–72px",
      });
  }
  for (const [key, value] of Object.entries(values))
    if (/asset\s*\(/i.test(value))
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: "Images belong in rule backgrounds, never color tokens",
      });
});
const skinAssetSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2400),
    aspect: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
    /** Resolved by the server. A model may reuse an existing id, never invent one. */
    id: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
  })
  .strict();
const chromeSchema = z
  .object({
    titlebarHeight: z.number().int().min(28).max(56).default(36),
    controlSize: z.number().int().min(16).max(32).default(22),
    controlGap: z.number().int().min(2).max(12).default(4),
    controlsSide: z.enum(["left", "right"]).default("right"),
    titleAlign: z.enum(["left", "center"]).default("left"),
    taskbarStyle: z.enum(["bar", "dock"]).default("bar"),
    taskbarHeight: z.number().int().min(36).max(64).default(44),
    taskbarInset: z.number().int().min(0).max(16).default(8),
    taskSize: z.number().int().min(28).max(52).default(32),
  })
  .strict()
  .superRefine((chrome, ctx) => {
    if (
      chrome.controlSize > chrome.titlebarHeight - 4 ||
      chrome.taskSize > chrome.taskbarHeight - 4
    )
      ctx.addIssue({
        code: "custom",
        message: "Controls and tasks must fit their bars with at least 4px clearance",
      });
  });
export const skinDefinitionSchema = z
  .object({
    format: z.literal(1),
    intent: z.string().trim().max(2400).optional(),
    chrome: chromeSchema.optional(),
    assets: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), skinAssetSchema).optional(),
    light: tokens,
    dark: tokens,
    rules: z
      .array(
        z
          .object({
            target: z.enum(
              Object.keys(SKIN_TARGETS) as [
                keyof typeof SKIN_TARGETS,
                ...(keyof typeof SKIN_TARGETS)[],
              ],
            ),
            state: z
              .enum(["default", "hover", "active", "focus", "disabled", "unfocused"])
              .default("default"),
            mode: z.enum(["both", "light", "dark"]).default("both"),
            styles: z.partialRecord(z.enum(SKIN_PROPERTIES), cssValue),
            material: z
              .object({
                asset: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
                size: cssValue.default("256px 256px"),
                opacity: z.number().min(0).max(1).default(0.08),
                blend: z
                  .enum(["normal", "multiply", "screen", "soft-light", "overlay"])
                  .default("normal"),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(160),
  })
  .strict()
  .superRefine((definition, ctx) => {
    for (const [i, rule] of definition.rules.entries()) {
      if (
        rule.material &&
        (!definition.assets?.[rule.material.asset] ||
          !["window", "titlebar", "taskbar", "desktop", "windowBody"].includes(rule.target))
      )
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "material"],
          message:
            "Materials require a declared asset and a window/titlebar/taskbar/desktop/windowBody target",
        });
      if (
        rule.material &&
        ["titlebar", "taskbar", "windowBody"].includes(rule.target) &&
        rule.material.opacity > 0.12
      )
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "material", "opacity"],
          message: "Keep text-bearing surfaces quiet: material opacity must be at most 0.12",
        });
      if (rule.material && /asset\s*\(/i.test(rule.material.size))
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "material", "size"],
          message: "Use an image size, not an asset reference",
        });
      for (const [property, value] of Object.entries(rule.styles)) {
        if (property === "font-size" && !/^(1[0-9]|2[0-4])px$/.test(value))
          ctx.addIssue({
            code: "custom",
            path: ["rules", i, "styles", property],
            message: "Chrome font size must be 10–24px",
          });
        if (!/asset\s*\(/i.test(value)) continue;
        const references = [...value.matchAll(/asset\(([a-z][a-z0-9-]{0,39})\)/g)];
        if (
          !["background", "background-image", "border-image-source"].includes(property) ||
          references.length !== (value.match(/asset\s*\(/gi) ?? []).length ||
          references.some((m) => !definition.assets?.[m[1]!])
        )
          ctx.addIssue({
            code: "custom",
            path: ["rules", i, "styles", property],
            message: "Use asset(name) with a declared asset in a background or border image",
          });
      }
    }
  });
export type SkinDefinition = z.infer<typeof skinDefinitionSchema>;
export const emptySkinDefinition = (): SkinDefinition => ({
  format: 1,
  light: {},
  dark: {},
  rules: [],
});
// Split CSS image layers without splitting commas inside gradients/functions.
function backgroundLayers(value: string): string[] {
  let depth = 0,
    start = 0;
  const layers: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) {
      layers.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}
export const skinOutputSchema = z
  .object({ summary: z.string().trim().min(1).max(1000), definition: skinDefinitionSchema })
  .strict()
  .superRefine(({ definition }, ctx) => {
    for (const [index, rule] of definition.rules.entries()) {
      const layers = backgroundLayers(
        rule.styles["background-image"] ?? rule.styles.background ?? "",
      );
      if (
        ["titlebar", "taskbar"].includes(rule.target) &&
        layers.some((layer) => layer.includes("asset("))
      )
        ctx.addIssue({
          code: "custom",
          path: ["definition", "rules", index],
          message:
            "Keep titlebar/taskbar art subtle. Use the material field (opacity 0.03–0.10) instead of asset() backgrounds on these bars.",
        });
      const lastImage = layers.findLastIndex((layer) => layer.includes("asset("));
      const blends = (rule.styles["background-blend-mode"] ?? "normal")
        .split(",")
        .map((s) => s.trim());
      // Catch the common invisible-texture mistake: an opaque hex gradient in
      // front of the asset with normal compositing. Other CSS remains untouched.
      if (
        layers.some(
          (layer, i) =>
            i < lastImage &&
            blends[i % blends.length] === "normal" &&
            /gradient\(/.test(layer) &&
            /#[a-f0-9]{3}(?:[a-f0-9]{3})?\b/i.test(layer) &&
            !/(?:transparent|var\(|rgba?\(|hsla?\(|oklch\(|color-mix\(|#[a-f0-9]{8}\b|#[a-f0-9]{4}\b)/i.test(
              layer,
            ),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["definition", "rules", index, "styles"],
          message:
            "An opaque gradient hides the generated image. Put asset(name) FIRST and blend it over the gradient (e.g. soft-light, normal), or make the covering gradient translucent.",
        });
    }
    for (const mode of ["light", "dark"] as const)
      for (const [token, value] of Object.entries(definition[mode]))
        if (/gradient\(/i.test(value))
          ctx.addIssue({
            code: "custom",
            path: ["definition", mode, token],
            message: "Tokens are colors. Move this gradient into a rule background.",
          });
  });

export function compileSkin(id: Skin, definition: SkinDefinition, apiBase = ""): string {
  skinIdSchema.parse(id);
  const safe = skinDefinitionSchema.parse(definition);
  const root = `:root[data-custom-skin="${id}"]`;
  const origin = apiBase ? new URL(apiBase) : null;
  if (origin && !["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid image origin");
  const resolveAssets = (value: string) =>
    value.replace(/asset\(([a-z][a-z0-9-]*)\)/g, (_, name: string) => {
      const asset = safe.assets?.[name];
      return asset?.id ? `url("${origin?.origin ?? ""}/api/img/${asset.id}")` : "none";
    });
  const declarations = (values: Record<string, string>, prefix = "") =>
    Object.entries(values)
      .map(([key, value]) => `${prefix}${key}:${resolveAssets(value)} !important`)
      .join(";");
  const states = {
    default: "",
    hover: ":hover",
    active: ":is(:active,[data-active],[aria-selected=true])",
    focus: ":focus-visible",
    disabled: ":disabled",
    unfocused: ":not([data-focused])",
  };
  const chrome: string[] = [];
  const emit = (selector: string, styles: Record<string, string>) =>
    chrome.push(
      `${selector
        .split(",")
        .map((s) => `${root} ${s}`)
        .join(",")}{${declarations(styles)}}`,
    );
  emit(".vibe-title,.vibe-taskitem,.vibe-startbtn", {
    "font-family": "var(--font-title, var(--font-sans))",
  });
  emit(".vibe-taskitem-label", { "font-family": "inherit" });
  if (safe.chrome) {
    const c = safe.chrome;
    const left = c.controlsSide === "left";
    const space = c.controlSize * 4 + c.controlGap * 3 + 16;
    emit(".vibe-titlebar", {
      position: "relative",
      height: `${c.titlebarHeight}px`,
      padding: `0 ${left && c.titleAlign !== "center" ? 12 : space}px 0 ${!left && c.titleAlign !== "center" ? 12 : space}px`,
      "justify-content": "center",
    });
    if (c.titleAlign === "center")
      emit(".vibe-titlebar > svg", {
        position: "absolute",
        left: left ? "auto" : "12px",
        right: left ? "12px" : "auto",
      });
    emit(".vibe-title", { flex: "1 1 auto", "max-width": "100%", "text-align": c.titleAlign });
    emit(".vibe-winbtns", {
      position: "absolute",
      left: left ? "8px" : "auto",
      right: left ? "auto" : "8px",
      top: "0",
      bottom: "0",
      gap: `${c.controlGap}px`,
    });
    emit(".vibe-winbtn", {
      width: `${c.controlSize}px`,
      height: `${c.controlSize}px`,
      "flex-shrink": "0",
    });
    emit(".vibe-winbtn svg", { display: "block", opacity: "1", width: "12px", height: "12px" });
    emit(".vibe-winbtn::after", { display: "none" });
    for (const [index, kind] of (left
      ? ["close", "min", "max", "save"]
      : ["save", "min", "max", "close"]
    ).entries())
      emit(`.vibe-winbtn-${kind}`, { order: String(index) });
    const dock = c.taskbarStyle === "dock";
    const inset = dock ? c.taskbarInset : 0;
    chrome.push(
      `${root},${root}.dark{--taskbar-h:${c.taskbarHeight + inset + (dock ? 8 : 0)}px !important}`,
    );
    emit(".vibe-taskbar", {
      left: dock ? "50%" : "0",
      right: "auto",
      transform: dock ? "translateX(-50%)" : "none",
      bottom: `${inset}px`,
      width: dock ? "max-content" : "100%",
      "max-width": dock ? "calc(100vw - 24px)" : "100%",
      height: `${c.taskbarHeight}px`,
      padding: "2px 8px",
      gap: "6px",
    });
    emit(".vibe-taskitem", {
      position: "relative",
      height: `${c.taskSize}px`,
      width: dock ? `${c.taskSize}px` : "auto",
      padding: dock ? "0" : "0 10px",
      "justify-content": "center",
    });
    emit(".vibe-startbtn", { height: `${c.taskSize}px`, margin: "0", padding: "0 10px" });
    emit(".vibe-taskitem svg,.vibe-taskitem img", {
      width: dock ? "22px" : "16px",
      height: dock ? "22px" : "16px",
    });
    emit(
      ".vibe-taskitem-label",
      dock
        ? {
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            translate: "-50% 0",
            "max-width": "none",
            padding: "3px 8px",
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
            "border-radius": "4px",
            opacity: "0",
            "pointer-events": "none",
          }
        : {
            position: "static",
            translate: "none",
            opacity: "1",
            padding: "0",
            background: "transparent",
            border: "none",
            "box-shadow": "none",
            color: "inherit",
          },
    );
    if (dock) emit(".vibe-taskitem:hover .vibe-taskitem-label", { opacity: "1" });
  }
  // Older v1 generators put gradients in these color tokens. Render their intended
  // backgrounds without rewriting immutable versions; new output uses rule backgrounds.
  for (const [mode, values] of [
    [":not(.dark)", safe.light],
    [".dark", { ...safe.light, ...safe.dark }],
  ] as const)
    for (const [token, target] of [
      ["desktop", "desktop"],
      ["window-titlebar", "titlebar"],
    ] as const)
      if (
        values[token]?.includes("gradient(") &&
        !safe.rules.some(
          (rule) =>
            rule.target === target &&
            rule.state === "default" &&
            (rule.mode === "both" || rule.mode === (mode === ".dark" ? "dark" : "light")) &&
            (rule.styles.background || rule.styles["background-image"]),
        )
      )
        chrome.push(
          `${root}${mode} ${SKIN_TARGETS[target][0]}{background:${values[token]} !important}`,
        );
  return [
    `${root}{${declarations({ "font-title": "var(--font-sans)", ...safe.light }, "--")}}`,
    `${root}.dark{${declarations({ ...safe.light, ...safe.dark }, "--")}}`,
    ...chrome,
    ...safe.rules.map((rule) => {
      const scope =
        root + (rule.mode === "dark" ? ".dark" : rule.mode === "light" ? ":not(.dark)" : "");
      const wallpaper =
        rule.target === "desktop" &&
        rule.state === "default" &&
        (rule.styles.background || rule.styles["background-image"])
          ? `${scope} .vibe-wallpaper{display:none !important}\n`
          : "";
      const selectors = SKIN_TARGETS[rule.target].map((selector) =>
        rule.state === "unfocused" && rule.target !== "window"
          ? `${scope} .vibe-window:not([data-focused]) ${selector}`
          : `${scope} ${selector}${states[rule.state]}`,
      );
      let extra = "";
      // Legacy skins styled only the window title. Share that family with task names
      // unless the skin explicitly gives tasks their own font.
      if (
        rule.target === "title" &&
        rule.state === "default" &&
        rule.styles["font-family"] &&
        !safe.rules.some((r) => r.target === "task" && r.styles["font-family"])
      )
        extra += `${scope} .vibe-taskitem{${declarations({ "font-family": rule.styles["font-family"] })}}`;
      if (rule.material) {
        const m = rule.material;
        extra += `${selectors.join(",")}{isolation:isolate !important;${rule.target === "titlebar" ? "position:relative !important" : ""}}`;
        extra += `${selectors.map((selector) => `${selector}::before`).join(",")}{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;${declarations({ "background-image": `asset(${m.asset})`, "background-size": m.size, "background-repeat": "repeat", opacity: String(m.opacity), "mix-blend-mode": m.blend })}}`;
      }
      return wallpaper + `${selectors.join(",")}{${declarations(rule.styles)}}` + extra;
    }),
  ].join("\n");
}

export type SkinRequestStatus =
  | "generating"
  | "validating"
  | "assets"
  | "refining"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface SkinRequest {
  id: string;
  skinId: Skin;
  prompt: string;
  baseVersionId: string | null;
  status: SkinRequestStatus;
  chars: number;
  summary: string;
  error: string;
  versionId: string | null;
  createdAt: number;
  updatedAt: number;
}
export const skinRequestRunning = (status: SkinRequestStatus) =>
  status === "generating" ||
  status === "validating" ||
  status === "assets" ||
  status === "refining";
export interface SkinVersion {
  id: string;
  number: number;
  summary: string;
  createdAt: number;
}
export interface SkinRecord {
  id: Skin;
  name: string;
  builtIn: boolean;
  /** Immutable packaged chrome is retained only when explicitly duplicating a built-in. Blank skins have none. */
  foundation: BuiltinSkin | null;
  activeVersionId: string | null;
  definition: SkinDefinition;
  versions: SkinVersion[];
  requests: SkinRequest[];
  loadError?: boolean;
}
export interface SkinState {
  skins: SkinRecord[];
}
// Fits the existing 32 MiB WebSocket envelope including JSON escaping.
export const MAX_SKIN_PACKAGE_BYTES = 24 * 1024 * 1024;
export const skinPackageSchema = z
  .object({
    vibeskin: z.literal(1),
    name: z.string().trim().min(1).max(80),
    foundation: z.enum(BUILTIN_SKIN_IDS).nullable(),
    definition: skinDefinitionSchema,
    images: z.record(
      z.string().regex(/^[a-f0-9]{32}$/),
      z
        .object({
          mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
          data: z
            .string()
            .min(4)
            .max(MAX_SKIN_PACKAGE_BYTES)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        })
        .strict(),
    ),
  })
  .strict();
export type SkinPackage = z.infer<typeof skinPackageSchema>;
export const skinCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(80),
    sourceId: skinIdSchema.optional(),
  }),
  z.object({
    action: z.literal("rename"),
    id: skinIdSchema,
    name: z.string().trim().min(1).max(80),
  }),
  z.object({ action: z.literal("delete"), id: skinIdSchema }),
  z.object({
    action: z.literal("activate"),
    id: skinIdSchema,
    versionId: z.string().max(100).optional(),
  }),
  z.object({
    action: z.literal("generate"),
    id: skinIdSchema,
    prompt: z.string().trim().min(1).max(16000),
  }),
  z.object({ action: z.literal("cancel"), id: skinIdSchema }),
  z.object({ action: z.literal("export"), id: skinIdSchema }),
  z.object({ action: z.literal("import"), json: z.string().min(1).max(MAX_SKIN_PACKAGE_BYTES) }),
]);
export type SkinCommand = z.infer<typeof skinCommandSchema>;
