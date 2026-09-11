const fonts = new Map<string, Promise<string>>();
async function fontData(url: string) {
  if (url.startsWith("data:")) return url;
  if (!fonts.has(url))
    fonts.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error("Font unavailable");
          return r.blob();
        })
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            }),
        )
        .catch(() => ""),
    );
  return fonts.get(url)!;
}

/** Reuse shipped CSS/fonts and live skin tokens; no model-generated styles enter this copy. */
export async function runtimeTheme(surface: HTMLElement, apiBase: string) {
  const css: string[] = [];
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode instanceof Element && sheet.ownerNode.closest(".ai-surface")) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      let text = rule.cssText;
      const urls = [...text.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
      for (const match of urls) {
        const url = new URL(match[1]!, sheet.href ?? document.baseURI).href;
        const resolved =
          rule instanceof CSSFontFaceRule
            ? await fontData(url)
            : url.replace(`${location.origin}/api/img/`, `${apiBase || location.origin}/api/img/`);
        text = text.replace(match[0], `url(${JSON.stringify(resolved)})`);
      }
      css.push(text);
    }
  }
  css.push(runtimeBaseStyle(surface));
  return {
    type: "theme",
    css: css.join("\n"),
    className: document.documentElement.className,
    dataset: { ...document.documentElement.dataset },
  };
}

/** Synchronous tokens prevent a dark/un-styled flash while packaged fonts load. */
export function runtimeBaseStyle(surface: HTMLElement) {
  const computed = getComputedStyle(surface);
  const values = [...computed]
    .filter((key) => key.startsWith("--"))
    .map((key) => `${key}:${computed.getPropertyValue(key)};`)
    .join("");
  return `:root{${values}} html,body{margin:0;width:100%;height:100%;overflow:hidden} body{font-family:${computed.fontFamily};font-size:${computed.fontSize};color:var(--foreground);background:transparent} #surface{height:100%;width:100%;overflow:auto;contain:layout paint style;isolation:isolate} #surface [hidden]{display:none!important} #surface[data-runtime-paused] *,#surface[data-runtime-paused] *::before,#surface[data-runtime-paused] *::after{animation-play-state:paused!important} @media(prefers-reduced-motion:reduce){#surface *,#surface *::before,#surface *::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important}}`;
}
