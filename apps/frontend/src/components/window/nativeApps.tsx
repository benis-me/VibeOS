import type { PresetAppId } from "@vibeos/shared";
import { SettingsApp } from "@/components/settings/SettingsApp";
import { ActivityMonitorApp } from "@/components/activity/ActivityMonitorApp";
import { AppStoreApp } from "@/components/store/AppStoreApp";

/**
 * Apps rendered natively (real React), not AI-hallucinated — they control real
 * system state. Everything else goes through the AI HTML surface.
 */
export const NATIVE_APPS: Partial<Record<PresetAppId, () => React.ReactNode>> = {
  settings: () => <SettingsApp />,
  "activity-monitor": () => <ActivityMonitorApp />,
  "app-store": () => <AppStoreApp />,
};
