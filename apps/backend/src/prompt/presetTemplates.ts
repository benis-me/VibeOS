import type { PresetAppId } from "@vibeos/shared/domain";

/**
 * Hints that seed the AI's first render for preset apps. These are NOT the
 * literal HTML — they describe the kind of app the AI should hallucinate so
 * preset apps feel recognizable while still being AI-generated.
 */
const HINTS: Partial<Record<PresetAppId, string>> = {
  browser:
    "A web browser into a fictional internet. Structure: a top chrome containing back/forward buttons and the address bar wrapped in its OWN region: <form data-vibeos-region='addressbar' data-vibeos-action='navigate'><input name='url' value='<current url>' …></form>; then the page body as <div data-vibeos-region='page'>…</div>. " +
    "" +
    "CRITICAL navigation: the user's typed text arrives in the OPERATION as value=/form=. " +
    "On navigate you MUST return BOTH regions: (1) data-vibeos-region='addressbar' with the input value set to the EXACT URL the user typed, and (2) data-vibeos-region='page' rendering the page the user ASKED FOR (not a random/homepage). " +
    "Never ignore the user's input or keep the old URL. Links inside the page carry data-vibeos-action='navigate' data-url='…'.",
  "command-line":
    "A terminal on the REAL VibeOS system disk. First render: a scrollback area wrapped as <div data-vibeos-region='scrollback'> containing a shell banner, then the prompt line as its own region: <form data-vibeos-region='prompt' data-vibeos-action='run' data-cwd=''><span>vibeos:/$</span><input name='cmd' …></form>. " +
    "data-cwd is the working directory as a system disk path ('' is the root, 'Documents/notes' a folder) and the prompt text shows it. " +
    "" +
    "Files are real: [SYSTEM DISK] lists the working directory. " +
    "cd checks that the folder exists and also returns the prompt region with the new data-cwd. " +
    "cat reads content with a files read request and prints it when the reply arrives. " +
    "touch, mkdir, rm, mv, cp and redirects go through files requests (write, mkdir, trash, move, copy). " +
    "Commands unrelated to files may stay imaginative. " +
    "IMPORTANT incremental behavior: when the user runs a command, or a files reply for a command arrives, DO NOT rebuild the whole terminal. " +
    "Return ONLY <div data-vibeos-region='scrollback' data-vibeos-append> containing just the new lines (the echoed command and/or its output); the OS appends it to the existing scrollback, so never repeat earlier lines and never invent other region ids. " +
    "Keep the same prompt/input. For clear, return the scrollback region without data-vibeos-append. " +
    "" +
    'Every reply that returns HTML also declares {"type":"app-state"} without data: the terminal keeps no shared records.',
  "file-manager":
    "A file manager browsing the VibeOS virtual filesystem. " +
    "Show a toolbar, a path breadcrumb, and a grid/list of files & folders (each data-vibeos-action='open' data-name=...). " +
    "Reflect any real desktop files from system state when known.",
  settings:
    "A system settings panel. Show sections for Appearance (theme), About (boot count, version), and Model performance. " +
    "Controls carry data-vibeos-action. Keep it consistent with the real settings provided in system state.",
};

export function presetHint(presetId: PresetAppId | undefined): string | undefined {
  if (!presetId) return undefined;
  return HINTS[presetId];
}
