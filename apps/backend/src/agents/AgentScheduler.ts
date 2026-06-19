/**
 * Agent scheduler. Wires the event-driven UI generation agent and the
 * timer-driven system-event + maintenance agents.
 */
import type { TimerAgent } from "./types.ts";
import { registerUiGenerationAgent } from "./UiGenerationAgent.ts";
import { SystemEventAgent } from "./SystemEventAgent.ts";
import { MaintenanceAgent } from "./MaintenanceAgent.ts";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";

let started = false;
const timers: ReturnType<typeof setTimeout>[] = [];

export function startAgents(): void {
  if (started) return;
  started = true;

  // Event-driven: UI generation reacts to user ops and window opens.
  registerUiGenerationAgent();

  // Timer-driven ambient agents.
  scheduleTimer(SystemEventAgent, () => loadSettings().prefs.proactiveAgents !== false);
  scheduleTimer(MaintenanceAgent, () => true);

  console.log("[agents] scheduler started (ui-generation + system-event + maintenance)");
}

function scheduleTimer(agent: TimerAgent, enabled: () => boolean): void {
  const loop = () => {
    const jitter = agent.intervalMs * (0.5 + Math.random());
    const t = setTimeout(async () => {
      if (enabled()) {
        try {
          await agent.tick();
        } catch (e) {
          console.warn(`[agents] ${agent.role} tick failed:`, e instanceof Error ? e.message : e);
        }
      }
      loop();
    }, jitter);
    timers.push(t);
  };
  loop();
}

export function stopAgents(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
