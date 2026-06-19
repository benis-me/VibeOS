export type PresetAppId =
  | "browser"
  | "command-line"
  | "file-manager"
  | "settings"
  | "activity-monitor"
  | "app-store"
  | "recycle-bin";

export type AppKind = "preset" | "virtual";

/** Preset apps rendered natively (real React), never AI-hallucinated. */
export const NATIVE_PRESET_APPS: PresetAppId[] = ["settings", "activity-monitor", "app-store"];

export interface AppManifest {
  /** Short description used to seed the AI prompt for a virtual app. */
  description?: string;
  /** Optional category for grouping in the start menu. */
  category?: string;
  /** Default window size hint. */
  defaultSize?: { w: number; h: number };
  /**
   * If true, only ONE window of this app may exist — opening it again focuses
   * the existing window (e.g. Settings, Recycle Bin). If false/undefined, the
   * app can be opened multiple times (e.g. Browser, Files, Terminal).
   */
  singleInstance?: boolean;
  /**
   * A frozen HTML snapshot. When set, opening the app seeds the window with this
   * markup immediately (instead of an AI first render) — how "saved"/exported
   * apps preserve their state. The AI still takes over on the next interaction.
   */
  seedHtml?: string;
  [key: string]: unknown;
}

export interface AppDescriptor {
  id: string;
  name: string;
  kind: AppKind;
  /** Set when kind === 'preset'. */
  presetId?: PresetAppId;
  /** Icon identifier (hugeicons name) or emoji. */
  icon: string;
  manifest: AppManifest;
  isInstalled: boolean;
  createdAt: number;
  updatedAt: number;
}
