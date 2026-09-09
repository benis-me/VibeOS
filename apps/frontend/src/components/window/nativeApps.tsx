import type { PresetAppId } from "@vibeos/shared";
import { SettingsApp } from "@/components/settings/SettingsApp";
import { ActivityMonitorApp } from "@/components/activity/ActivityMonitorApp";
import { AppStoreApp } from "@/components/store/AppStoreApp";
import { RecycleBinApp } from "@/components/recyclebin/RecycleBinApp";
import { WelcomeApp } from "@/components/welcome/WelcomeApp";
import { FilesApp } from "@/components/files/FilesApp";
import { FileViewerApp } from "@/components/files/FileViewerApp";

/**
 * Apps rendered natively (real React), not AI-hallucinated — they control real
 * system state. Everything else goes through the AI HTML surface. The renderer
 * receives its window id (used by e.g. Welcome to self-center/size).
 */
export const NATIVE_APPS: Partial<Record<PresetAppId, (windowId: string) => React.ReactNode>> = {
  "file-manager": (windowId) => <FilesApp windowId={windowId} />,
  "text-viewer": (windowId) => <FileViewerApp windowId={windowId} />,
  "media-viewer": (windowId) => <FileViewerApp windowId={windowId} media />,
  settings: () => <SettingsApp />,
  "activity-monitor": () => <ActivityMonitorApp />,
  "app-store": () => <AppStoreApp />,
  "recycle-bin": (windowId) => <RecycleBinApp windowId={windowId} />,
  welcome: (windowId) => <WelcomeApp windowId={windowId} />,
};
