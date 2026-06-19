import { loadKernel, saveGlobalState } from "../db/repositories/KernelRepo.ts";
import { listOpenWindows } from "../db/repositories/WindowRepo.ts";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";

/**
 * In-memory mirror of the global system state that the AI gets to "see".
 * Write-through to SQLite. Kept compact (it goes into every prompt).
 */
class KernelStateCache {
  bootCount = 0;
  private global: Record<string, unknown> = {};

  load(): void {
    const k = loadKernel();
    this.bootCount = k.bootCount;
    this.global = k.globalState;
  }

  setBootCount(n: number): void {
    this.bootCount = n;
  }

  get(): Record<string, unknown> {
    return this.global;
  }

  /** Patch and persist global state. */
  async patch(partial: Record<string, unknown>): Promise<void> {
    this.global = { ...this.global, ...partial };
    await saveGlobalState(this.global);
  }

  /** A compact snapshot for the prompt: time, open apps, recent events. */
  snapshotForPrompt(): Record<string, unknown> {
    const openWindows = listOpenWindows().map((w) => ({
      windowId: w.id,
      appId: w.appId,
      title: w.title,
      state: w.state,
    }));
    return {
      bootCount: this.bootCount,
      now: new Date().toISOString(),
      theme: loadSettings().theme,
      openWindows,
      ...this.global,
    };
  }
}

export const kernelState = new KernelStateCache();
