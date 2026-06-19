import DOMPurify from "dompurify";

/**
 * Matches emoji / pictographs (and common modifiers/ZWJ/variation selectors).
 * VibeOS forbids emoji in any generated UI — this is the last-line enforcement
 * if a model slips one through despite the prompt rules.
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "");
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
export function sanitizeAiHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ["data-vibeos-action", "data-vibeos-region", "target"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base"],
    FORBID_ATTR: ["formaction", "action", "ping"],
    ALLOW_DATA_ATTR: true,
  });
  return stripEmoji(clean);
}
