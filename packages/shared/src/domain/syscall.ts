import type { NotificationKind } from "./notification.ts";
import type { AppManifest } from "./app.ts";
import type { VfsLocation } from "./vfs.ts";
import type { WindowSize, WindowDisplayState } from "./window.ts";
import type { CommunicationCommand, MessageData } from "./communication.ts";

/** Calls the AI may request, interpreted by the backend SyscallInterpreter. */
export type Syscall =
  /** Omit data to explicitly retain shared state; supplied data replaces it at the render's revision. */
  | { type: "app-state"; data?: MessageData }
  | { type: "communication"; command: CommunicationCommand }
  | { type: "resize-window"; size: WindowSize }
  | { type: "window-state"; state: WindowDisplayState; windowIds: "all" | string[] }
  | {
      type: "notify";
      title: string;
      body?: string;
      kind?: NotificationKind;
    }
  | {
      type: "open";
      /** Open an existing app by id, or by preset id. */
      appId: string;
    }
  | {
      type: "spawn-window";
      /** Title for the new window. */
      title: string;
      /** What this window should show — fed to the AI as its first render. */
      prompt: string;
      context?: MessageData;
      /** Optional: attribute it to an existing app; otherwise a transient one. */
      appId?: string;
      /** Optional preferred size. */
      width?: number;
      height?: number;
    }
  | {
      type: "install";
      name: string;
      icon?: string;
      manifest?: AppManifest;
    }
  | {
      type: "create-file";
      name: string;
      mime?: string;
      content?: string;
      location?: VfsLocation;
    }
  | {
      type: "focus";
      windowId: string;
    }
  | {
      type: "close";
      /** Omit to close the window producing this call. */
      windowId?: string;
    }
  | {
      /**
       * Update this window's NATIVE chrome (the OS-provided shell around the AI
       * content, e.g. a browser address bar). Reverse channel: AI content → shell.
       */
      type: "chrome";
      set: Record<string, string>;
    };

export interface SyscallBatch {
  calls: Syscall[];
}
