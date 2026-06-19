import type { PresetAppId } from "@vibeos/shared/domain";

/**
 * Hints that seed the AI's first render for preset apps. These are NOT the
 * literal HTML — they describe the kind of app the AI should hallucinate so
 * preset apps feel recognizable while still being AI-generated.
 */
const HINTS: Partial<Record<PresetAppId, string>> = {
  browser:
    "A web browser into a fictional internet. Structure: a top chrome containing back/forward buttons and the address bar wrapped in its OWN region: <form data-vibeos-region='addressbar' data-vibeos-action='navigate'><input name='url' value='<current url>' …></form>; then the page body as <div data-vibeos-region='page'>…</div>. " +
    "CRITICAL navigation: the user's typed text arrives in the OPERATION as value=/form=. On navigate you MUST return BOTH regions: (1) data-vibeos-region='addressbar' with the input value set to the EXACT URL the user typed, and (2) data-vibeos-region='page' rendering the page the user ASKED FOR (not a random/homepage). Never ignore the user's input or keep the old URL. Links inside the page carry data-vibeos-action='navigate' data-url='…'.",
  "command-line":
    "A terminal emulator. First render: a scrollback area wrapped as <div data-vibeos-region='scrollback'> containing a shell banner, then a <form data-vibeos-action='run'><input name='cmd' …></form> prompt line. " +
    "IMPORTANT incremental behavior: when the user runs a command, DO NOT rebuild the whole terminal. Return ONLY the updated <div data-vibeos-region='scrollback'> that APPENDS the echoed command line and its output to all the PREVIOUS scrollback content (which is in the CURRENT UI you were given) — never drop earlier lines. Keep the same prompt/input. This makes commands accumulate like a real terminal instead of re-rendering.",
  "file-manager":
    "A file manager browsing the VibeOS virtual filesystem. Show a toolbar, a path breadcrumb, and a grid/list of files & folders (each data-vibeos-action='open' data-name=...). Reflect any real desktop files from system state when known.",
  settings:
    "A system settings panel. Show sections for Appearance (theme), About (boot count, version), and Model performance. Controls carry data-vibeos-action. Keep it consistent with the real settings provided in system state.",
};

export function presetHint(presetId: PresetAppId | undefined): string | undefined {
  if (!presetId) return undefined;
  return HINTS[presetId];
}
