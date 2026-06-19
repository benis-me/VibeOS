/**
 * VibeOS forbids emoji in any generated UI/content. This strips emoji and
 * related pictographs/modifiers from a string. Shared by client and server so
 * enforcement is consistent everywhere AI text surfaces.
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{2122}\u{2139}]/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}
