export interface TimerAgent {
  role: "system-event" | "maintenance";
  /** Base interval in ms; the scheduler adds jitter. */
  intervalMs: number;
  /** Run one cycle. */
  tick(): Promise<void>;
}
