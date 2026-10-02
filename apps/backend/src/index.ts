import { boot } from "./kernel/boot.ts";
import { installShutdown } from "./kernel/shutdown.ts";
import { startAgents } from "./agents/AgentScheduler.ts";
import { registerUiGenerationAgent } from "./agents/UiGenerationAgent.ts";
import { bus } from "./events/bus.ts";
import { env } from "./config/env.ts";

const { server, interrupted } = await boot();
installShutdown(server);

// UI generation is the OS itself: VIBEOS_AGENTS_DISABLED only stops the timers.
registerUiGenerationAgent();
// Finish the first paints the last shutdown cut off.
for (const windowId of interrupted) bus.emit("window.firstRender", { windowId });

if (!env.agentsDisabled) {
  startAgents();
}
