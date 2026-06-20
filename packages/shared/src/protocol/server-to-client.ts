import type { WindowState } from "../domain/window.ts";
import type { AppDescriptor } from "../domain/app.ts";
import type { VfsNode } from "../domain/vfs.ts";
import type { Notification } from "../domain/notification.ts";
import type { Settings, ProviderId, ProviderModel } from "../domain/settings.ts";
import type { AgentRole, AgentRun } from "../domain/agent.ts";

export type BootPhase = "connecting" | "restoring" | "ready";

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

export interface AppSearchResult {
  name: string;
  /** Short tagline describing the app. */
  description: string;
  /** An emoji or icon hint. */
  icon: string;
  /** Whether this is best as a full app or a glanceable desktop widget. */
  kind: "app" | "widget";
}

export interface BootStatePayload {
  phase: BootPhase;
  version: string;
  bootCount: number;
  settings: Settings;
  windows: WindowState[];
  apps: AppDescriptor[];
  desktopNodes: VfsNode[];
  recycleBinNodes: VfsNode[];
  notifications: Notification[];
  globalState: Record<string, unknown>;
  /** Current snapshots for already-open windows, keyed by windowId. */
  snapshots: Record<string, string>;
  /** Models discovered from the active provider, for the Settings model picker. */
  models: ModelInfo[];
  /** Providers usable on this host (CLI on PATH / API always), for Settings. */
  availableProviders: ProviderId[];
  /** Recent agent runs for the Activity Monitor. */
  agentRuns: AgentRun[];
}

export interface UiRegion {
  /** data-vibeos-region id. */
  region: string;
  html: string;
}

export interface UiPatchPayload {
  windowId: string;
  mode: "full" | "regions";
  html?: string;
  regions?: UiRegion[];
  /** true while streaming partial content. */
  streaming?: boolean;
  /** true on the final frame for this op. */
  done?: boolean;
}

export type ServerToClient =
  | { type: "s2c.boot.state"; payload: BootStatePayload }
  | { type: "s2c.boot.ready"; payload: Record<string, never> }
  | { type: "s2c.ui.patch"; payload: UiPatchPayload }
  | {
      type: "s2c.ui.busy";
      payload: { windowId: string; busy: boolean };
    }
  | { type: "s2c.window.opened"; payload: { window: WindowState } }
  | { type: "s2c.window.closed"; payload: { windowId: string } }
  | { type: "s2c.window.focused"; payload: { windowId: string } }
  | { type: "s2c.window.moved"; payload: { window: WindowState } }
  | { type: "s2c.window.stateChanged"; payload: { window: WindowState } }
  | { type: "s2c.syscall.notify"; payload: { notification: Notification } }
  | {
      type: "s2c.syscall.appInstalled";
      payload: { app: AppDescriptor; shortcut?: VfsNode };
    }
  | { type: "s2c.syscall.fileCreated"; payload: { node: VfsNode } }
  | { type: "s2c.vfs.changed"; payload: { node: VfsNode } }
  | { type: "s2c.vfs.removed"; payload: { ids: string[] } }
  | { type: "s2c.window.reordered"; payload: { ids: string[] } }
  /** Update a window's native chrome (e.g. browser address bar) — AI → shell. */
  | { type: "s2c.chrome.set"; payload: { windowId: string; patch: Record<string, string> } }
  | {
      type: "s2c.agent.event";
      payload: { role: AgentRole; kind: string; data?: unknown };
    }
  | { type: "s2c.agent.run"; payload: { run: AgentRun } }
  | { type: "s2c.activity.page"; payload: { runs: AgentRun[]; hasMore: boolean } }
  | { type: "s2c.settings.changed"; payload: { settings: Settings } }
  | { type: "s2c.models.updated"; payload: { models: ModelInfo[] } }
  | { type: "s2c.providers.updated"; payload: { availableProviders: ProviderId[] } }
  /** Refreshed model list for one API provider (Providers settings page). */
  | { type: "s2c.provider.models"; payload: { providerId: ProviderId; models: ProviderModel[] } }
  | {
      type: "s2c.app.searchResults";
      payload: { requestId: string; results: AppSearchResult[] };
    }
  | { type: "s2c.notification.read"; payload: { id: string | "all" } }
  | {
      type: "s2c.error";
      // `code` is a stable key localized on the client (error.<code>); `detail`
      // is raw, non-localized context (e.g. a provider error string, an app id).
      payload: { code: string; detail?: string; windowId?: string };
    };

export type ServerToClientType = ServerToClient["type"];
export type ServerToClientPayload<T extends ServerToClientType> = Extract<
  ServerToClient,
  { type: T }
>["payload"];
