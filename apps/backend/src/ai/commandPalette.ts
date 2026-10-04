import { run, recordSummary, recordStep } from "./SdkManager.ts";
import { parseAiOutput } from "./streamParser.ts";
import { ulid } from "@vibeos/shared/util";
import { listApps } from "../db/repositories/AppRepo.ts";
import { listOpenWindows } from "../db/repositories/WindowRepo.ts";
import { messageContext } from "../events/bus.ts";
import { communicationError, systemCall } from "../events/communication.ts";
import * as Syscalls from "../syscall/SyscallInterpreter.ts";
import { logger } from "../util/log.ts";

const log = logger("command");

const ROUNDS = 3;
// Reads (and showing a file) only: writes stay with apps that confirm them.
const REQUESTS: Record<string, string[]> = {
  files: ["list", "stat", "read", "open"],
  apps: ["list", "windows"],
  settings: ["get"],
};

const INSTRUCTION = `You are the COMMAND interpreter of VibeOS, an AI operating system. The user types a natural-language command; you carry it out by operating the OS on their behalf — emitting system calls.

Reply with ONLY a fenced code block tagged vibeos-syscall containing JSON, nothing else:
\`\`\`vibeos-syscall
{ "calls": [ { "type": "...", ... } ] }
\`\`\`

Available calls:
- open (appId) — launch an EXISTING app. Multi-instance apps open a new window; use focus(windowId) to return to an existing window. Use an id from installedApps.
- spawn-window (title, prompt, width?, height?) — create + generate a NEW app/window live. Use for "open/make/create a <thing>" when no installed app matches. "prompt" describes what the window should show; include any file content it should work on.
- install (name, icon, manifest?) — add a NEW app + desktop shortcut. icon = a lucide-react icon name in kebab-case (e.g. "calculator", "music", "calendar"). Use only when the user wants it permanently added.
- create-file (name, mime?, content?, location?) — create a NEW file; location defaults to "desktop", so the file appears at "Desktop/<name>".
- close (windowId) / focus (windowId) — act on a window from openWindows.
- window-state (windowIds, state) — minimize, maximize or restore existing windows WITHOUT regenerating their content. state is "minimized", "maximized" or "normal" (restore). windowIds is an array of real window IDs, or "all" for all open app/system windows (desktop widgets remain visible). Use one call for a batch, even if there are many windows. Example: "最小化所有窗口" → {"type":"window-state","windowIds":"all","state":"minimized"}. "还原所有窗口" uses state:"normal". For "other windows" or named apps, select the matching IDs from openWindows; focused/kind/state are provided.
- notify (title, body?, kind?) — show a notification.
- communication — read real system data, or show a file:
  {"type":"communication","command":{"action":"request","target":{"system":"files"},"topic":"list","data":{"path":"Documents"}}}
  files topics: list, stat, read (data.path on the system disk: Desktop, Documents, Medias…), open (shows the file in its viewer).
  apps topics: list, windows. settings topic: get (theme, locale, skin). Nothing else is available here.

Rounds:
- You have at most ${ROUNDS} rounds. When you need data first, emit ONLY those requests (no notify); the next round lists their results under [ROUND n RESULTS], already executed calls under [ROUND n DONE], and you continue from there.
- A round without read requests finishes the command.

Rules:
- Choose the SMALLEST set of calls that fulfills the command. Prefer 'open' for an existing app; 'spawn-window' to create something new; 'install' only to add permanently.
- At most 8 calls per round. These are VibeOS operations, not host shell commands. Do not invent unsupported actions or substitute closing windows for minimizing them. Never repeat a call that is already done.
- ALWAYS end the finishing round with a 'notify' call briefly confirming what you did, written in the user's language.
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
    state: w.state,
    focused: w.focused,
    kind: w.kind,
  }));
  return JSON.stringify({ installedApps, openWindows });
}

const clip = (value: unknown) => {
  const text = JSON.stringify(value) ?? "null";
  return text.length > 12_000 ? `${text.slice(0, 12_000)}… (truncated)` : text;
};

/**
 * Carry out a natural-language command: up to three rounds of model calls, where
 * read requests run at once and their results feed the next round. A newer
 * command aborts this one. Returns how many calls ran.
 */
export async function runCommand(text: string, abort?: AbortController): Promise<number> {
  const t0 = performance.now();
  const trace = { id: ulid() };
  const canCommit = () => !abort?.signal.aborted;
  const history: string[] = [];
  let count = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const result = await run({
      role: "system-event", // fast model — commands should feel snappy
      trigger: "user",
      systemPromptOverride: `${INSTRUCTION}\n\nCURRENT SYSTEM STATE:\n${systemContext()}`,
      prompt: [
        `[COMMAND]\n${text}`,
        ...history,
        round === ROUNDS && history.length
          ? "[FINAL ROUND] No more requests: act on these results and end with notify."
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      appName: "Command",
      traceId: trace.id,
      abort,
    });
    if (!canCommit()) return count;
    if (!result.ok) throw new Error(result.error ?? "Generation failed");
    const runTrace = { id: trace.id, runId: result.runId, hops: 0, windows: [] };
    const { syscalls, syscallError, renderError } = parseAiOutput(result.text);
    if (syscallError || renderError) {
      const error = syscallError ?? renderError!;
      await recordStep("syscall.rejected", { error }, runTrace, "error");
      throw new Error(error);
    }
    const reads = syscalls.filter(
      (c) => c.type === "communication" && !("topic" in c.command && c.command.topic === "open"),
    );
    if (reads.length && round === ROUNDS) throw new Error("command.tooManySteps");
    const done: string[] = [];
    const results: string[] = [];
    await messageContext.run(runTrace, async () => {
      for (const call of syscalls) {
        if (!canCommit()) return;
        if (call.type !== "communication") {
          await Syscalls.execute([call], { source: "syscall", canCommit });
          done.push(clip(call));
          count++;
          continue;
        }
        const command = call.command;
        let value: unknown;
        try {
          if (
            command.action !== "request" ||
            !("system" in command.target) ||
            !REQUESTS[command.target.system]?.includes(command.topic)
          )
            throw new Error("communication.unsupported");
          value = await systemCall(command.target.system, command.topic, command.data ?? null);
          count++;
        } catch (error) {
          value = { error: communicationError(error) };
        }
        results.push(`${clip(command)} → ${clip(value)}`);
      }
    });
    await recordSummary(
      result.runId,
      `"${text}" → ${syscalls.map((c) => c.type).join(", ") || "none"}`,
    );
    if (!canCommit() || !reads.length) break;
    history.push(
      `[ROUND ${round} RESULTS]\n${results.join("\n")}`,
      ...(done.length ? [`[ROUND ${round} DONE]\n${done.join("\n")}`] : []),
    );
  }
  log.info(`"${text}" → ${count} call(s) in ${(performance.now() - t0).toFixed(0)}ms`);
  return count;
}
