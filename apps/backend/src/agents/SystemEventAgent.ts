import type { TimerAgent } from "./types.ts";
import { run, recordSummary, recordStep, localSummary } from "../ai/SdkManager.ts";
import { parseAiOutput } from "../ai/streamParser.ts";
import { kernelState } from "../kernel/kernelState.ts";
import * as Syscalls from "../syscall/SyscallInterpreter.ts";
import { listApps } from "../db/repositories/AppRepo.ts";
import { getAppData, readApplicationVersion } from "../db/repositories/ApplicationRepo.ts";
import { listOpenWindows } from "../db/repositories/WindowRepo.ts";

/**
 * Ambient daemon: now and then, one of the user's own applications reports what
 * moved on in its world while they were away. Uses the fast model; without an
 * application that has records there is nothing to report and no model call.
 */
export const SystemEventAgent: TimerAgent = {
  role: "system-event",
  intervalMs: 75_000,

  async tick() {
    // Only fire if there's something going on (a window open) some of the time.
    const open = listOpenWindows();
    if (open.length === 0 && Math.random() > 0.4) return;
    const worlds = listApps().flatMap((app) => {
      if (!app.isInstalled || app.presetId || app.kind !== "virtual") return [];
      const { data } = getAppData(app.id);
      return data && typeof data === "object" && Object.keys(data).length ? [{ app, data }] : [];
    });
    if (!worlds.length) return;
    const { app, data } = worlds[Math.floor(Math.random() * worlds.length)]!;
    const definition = readApplicationVersion(app.id);
    const records = JSON.stringify(data);
    const prompt = `[APPLICATION]\n${JSON.stringify({
      name: app.name,
      intent: definition?.instructions ?? definition?.description ?? app.manifest.description ?? "",
    })}\n\n[RECORDS]\n${records.length > 3000 ? `${records.slice(0, 3000)}…` : records}\n\n[GLOBAL STATE]\n${JSON.stringify(kernelState.snapshotForPrompt())}\n\n[TASK]\nWrite at most one notification about what moved on in this application's world while the user was away, following from these records. Emit a single notify syscall and a summary. If nothing fits, return an empty calls array.`;

    const result = await run({ role: "system-event", trigger: "timer", prompt, appName: app.name });
    if (!result.ok) return;
    const parsed = parseAiOutput(result.text);
    if (parsed.syscallError || parsed.renderError) {
      await recordStep(
        "syscall.rejected",
        { error: parsed.syscallError ?? parsed.renderError },
        { id: result.runId!, runId: result.runId },
        "error",
      );
      return;
    }
    await recordSummary(result.runId, parsed.summary || localSummary("氛围事件", "Ambient event"));
    // Clicking the notification opens this application, which updates itself.
    const notes = parsed.syscalls.filter((call) => call.type === "notify").slice(0, 1);
    if (notes.length) await Syscalls.execute(notes, { source: "agent", appId: app.id });
  },
};
