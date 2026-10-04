import DOMPurify from "dompurify";
// The last-line emoji enforcement if a model slips one through the prompt rules.
import { stripEmoji } from "@vibeos/shared/util";

// Preserve semantic field identity without disabling DOMPurify's clobbering protection.
DOMPurify.addHook("beforeSanitizeAttributes", (node) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(node.nodeName)) {
    const el = node as Element;
    const name = el.getAttribute("name");
    if (name) el.setAttribute("data-vibeos-field", name);
  }
});

function renameAnimation(style: CSSStyleDeclaration, names: Map<string, string>) {
  const value = style.getPropertyValue("animation-name");
  if (value)
    style.setProperty(
      "animation-name",
      value
        .split(",")
        .map((name) => names.get(name.trim()) ?? name.trim())
        .join(","),
      style.getPropertyPriority("animation-name"),
    );
}

function scopedStyles(sheet: CSSStyleSheet, scope: string, names: Map<string, string>): string {
  const rules = (items: CSSRuleList): string =>
    Array.from(items)
      .map((rule) => {
        if (rule instanceof CSSStyleRule) {
          renameAnimation(rule.style, names);
          // Pseudo-elements cannot appear inside :is(). Native scope retains
          // their selectors while preventing any rule from escaping this surface.
          if (/::|:(?:before|after|first-line|first-letter)\b/.test(rule.selectorText))
            return `@scope (${scope}) { ${rule.selectorText} { ${rule.style.cssText} } }`;
          return `${scope} :is(${rule.selectorText}) { ${rule.style.cssText} }`;
        }
        if (rule instanceof CSSKeyframesRule) {
          const name = names.get(rule.name);
          if (!name) return "";
          rule.name = name;
          return rule.cssText;
        }
        if (rule instanceof CSSMediaRule)
          return `@media ${rule.conditionText} { ${rules(rule.cssRules)} }`;
        if (rule instanceof CSSSupportsRule)
          return `@supports ${rule.conditionText} { ${rules(rule.cssRules)} }`;
        // Global declarations (@import, @font-face, @property, etc.) must not enter the shell.
        return "";
      })
      .join("\n");
  return rules(sheet.cssRules);
}

/**
 * Sanitize AI-generated HTML before injecting it into a window surface.
 * - strips <script>, event handlers (on*), javascript: urls, frames
 * - keeps <form> (native submit is intercepted + prevented in the delegate;
 *   action/formaction are forbidden so nothing can actually navigate)
 * - keeps data-* attributes (used for event delegation + context)
 * - keeps inline styles and classes (the AI styles its own UI)
 * - strips any emoji (hard project rule: no emoji in generated UI)
 */
export function sanitizeAiHtml(html: string, windowId = "preview"): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ["data-vibeos-action", "data-vibeos-region", "target"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base"],
    FORBID_ATTR: ["formaction", "action", "ping"],
    ALLOW_DATA_ATTR: true,
    // Otherwise a leading <style> block is parsed into <head> and silently dropped.
    FORCE_BODY: true,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  const sheets = new Map<Element, CSSStyleSheet>();
  const names = new Map<string, string>();
  const collectNames = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSKeyframesRule && /^[a-zA-Z_][\w-]*$/.test(rule.name))
        names.set(rule.name, `vibeos-${windowId}-${rule.name}`);
      else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule)
        collectNames(rule.cssRules);
    }
  };
  for (const style of template.content.querySelectorAll("style")) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent ?? "");
      collectNames(sheet.cssRules);
      sheets.set(style, sheet);
    } catch {
      style.remove();
    }
  }
  for (const [style, sheet] of sheets)
    style.textContent = scopedStyles(
      sheet,
      `.ai-surface[data-ai-window="${CSS.escape(windowId)}"]`,
      names,
    ).replace(/</g, "\\3c "); // CSSOM can decode escapes into a raw closing style tag.
  for (const element of template.content.querySelectorAll<HTMLElement>("[style]"))
    renameAnimation(element.style, names);
  return stripEmoji(template.innerHTML);
}
