import { run, recordSummary } from "./SdkManager.ts";
import { parseAiOutput } from "./streamParser.ts";
import type { Syscall } from "@vibeos/shared/domain";
import { listApps } from "../db/repositories/AppRepo.ts";
import { listOpenWindows } from "../db/repositories/WindowRepo.ts";
import { logger } from "../util/log.ts";

const log = logger("command");

const INSTRUCTION = `You are the COMMAND interpreter of VibeOS, an AI operating system. The user types a natural-language command; you carry it out by operating the OS on their behalf — emitting system calls.

Reply with ONLY a fenced code block tagged vibeos-syscall containing JSON, nothing else:
\`\`\`vibeos-syscall
{ "calls": [ { "type": "...", ... } ] }
\`\`\`

Available calls:
- open (appId) — open/focus an EXISTING app. Use an id from installedApps.
- spawn-window (title, prompt, width?, height?) — create + generate a NEW app/window live. Use for "open/make/create a <thing>" when no installed app matches. "prompt" describes what the window should show.
- install (name, icon, manifest?) — add a NEW app + desktop shortcut. icon = a lucide-react icon name in kebab-case (e.g. "calculator", "music", "calendar"). Use only when the user wants it permanently added.
- create-file (name, mime?, content?, location?) — create a file (location defaults to "desktop").
- close (windowId) / focus (windowId) — act on a window from openWindows.
- notify (title, body?, kind?) — show a notification.

Rules:
- Choose the SMALLEST set of calls that fulfills the command. Prefer 'open' for an existing app; 'spawn-window' to create something new; 'install' only to add permanently.
- ALWAYS end with a 'notify' call briefly confirming what you did, written in the user's language.
- If the command is unclear or impossible, emit ONLY a single 'notify' explaining that.
- Output nothing outside the vibeos-syscall block.`;

/** Compact snapshot of what the command can act on (installed apps, open windows). */
function systemContext(): string {
  const installedApps = listApps().map((a) => ({
    id: a.id,
    name: a.name,
    preset: a.presetId ?? null,
  }));
  const openWindows = listOpenWindows().map((w) => ({
    windowId: w.id,
    title: w.title,
    appId: w.appId,
  }));
  return JSON.stringify({ installedApps, openWindows });
}

/**
 * Interpret a natural-language command into a batch of syscalls. The caller
 * executes them. A newer command aborts this one (abort → empty batch).
 */
export async function runCommand(text: string, abort?: AbortController): Promise<Syscall[]> {
  const t0 = performance.now();
  const result = await run({
    role: "system-event", // fast model — commands should feel snappy
    trigger: "user",
    systemPromptOverride: `${INSTRUCTION}\n\nCURRENT SYSTEM STATE:\n${systemContext()}`,
    prompt: `[COMMAND]\n${text}`,
    appName: "Command",
    abort,
  });
  if (abort?.signal.aborted) return [];
  const { syscalls } = parseAiOutput(result.text);
  await recordSummary(result.runId, `"${text}" → ${syscalls.length} call(s)`);
  log.info(
    `"${text}" → ${syscalls.map((c) => c.type).join(", ") || "none"} in ${(performance.now() - t0).toFixed(0)}ms`,
  );
  return syscalls;
}
