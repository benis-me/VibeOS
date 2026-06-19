import type { NotificationKind } from "./notification.ts";
import type { AppManifest } from "./app.ts";
import type { VfsLocation } from "./vfs.ts";

/** Calls the AI may request, interpreted by the backend SyscallInterpreter. */
export type Syscall =
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
      windowId: string;
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
