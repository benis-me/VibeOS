import type { TimerAgent } from "./types.ts";
import { run, recordSummary } from "../ai/SdkManager.ts";
import { parseAiOutput } from "../ai/streamParser.ts";
import { kernelState } from "../kernel/kernelState.ts";
import * as Syscalls from "../syscall/SyscallInterpreter.ts";
import { listOpenWindows } from "../db/repositories/WindowRepo.ts";

/**
 * Ambient daemon: periodically invents small believable system events
 * (notifications) so the OS feels alive. Uses the fast model.
 */
export const SystemEventAgent: TimerAgent = {
  role: "system-event",
  intervalMs: 75_000,

  async tick() {
    // Only fire if there's something going on (a window open) some of the time.
    const open = listOpenWindows();
    if (open.length === 0 && Math.random() > 0.4) return;

    const prompt = `[GLOBAL STATE]\n${JSON.stringify(kernelState.snapshotForPrompt())}\n\n[TASK]\nInvent at most one small, atmospheric system event appropriate to the current state. Emit a single notify syscall and a summary. If nothing fits, return an empty calls array.`;

    const result = await run({ role: "system-event", trigger: "timer", prompt, appName: "System" });
    if (!result.ok) return;
    const parsed = parseAiOutput(result.text);
    await recordSummary(result.runId, parsed.summary || "Ambient event");
    if (parsed.syscalls.length > 0) {
      await Syscalls.execute(parsed.syscalls, { source: "agent" });
    }
  },
};
