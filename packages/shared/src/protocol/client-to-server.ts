import type { Settings } from "../domain/settings.ts";
import type { VfsLocation } from "../domain/vfs.ts";

/** A delegated event from inside an AI-generated window surface. */
export interface AiOp {
  kind: "click" | "input" | "submit" | "change" | "key" | "custom";
  /** The data-vibeos-action value of the target element. */
  action?: string;
  /** CSS selector or stable ref to the target (best-effort). */
  sel?: string;
  /** data-* attributes collected from the target. */
  dataset?: Record<string, string>;
  /** Current value for input/change. */
  value?: string;
  /** Serialized form fields for submit. */
  formData?: Record<string, string>;
}

export type DragPayloadKind =
  | "text"
  | "image"
  | "file"
  | "desktop-object"
  | "app-shortcut";

export interface DragPayload {
  kind: DragPayloadKind;
  /** id (vfs node / app) or literal value (text/image url). */
  ref: string;
  label?: string;
}

export interface DropTarget {
  /** Window receiving the drop, or undefined for desktop. */
  windowId?: string;
  action?: string;
  sel?: string;
}

export type ClientToServer =
  | { type: "c2s.boot.hello"; payload: { clientId?: string } }
  | { type: "c2s.op"; payload: { windowId: string; op: AiOp } }
  | {
      type: "c2s.op.dragdrop";
      payload: { windowId?: string; source: DragPayload; target: DropTarget };
    }
  | { type: "c2s.window.open"; payload: { appId: string; hint?: string } }
  | { type: "c2s.window.close"; payload: { windowId: string } }
  | { type: "c2s.window.focus"; payload: { windowId: string } }
  | { type: "c2s.window.minimize"; payload: { windowId: string } }
  | { type: "c2s.window.maximize"; payload: { windowId: string } }
  | {
      type: "c2s.window.move";
      payload: { windowId: string; x: number; y: number; w: number; h: number };
    }
  | {
      type: "c2s.vfs.move";
      payload: {
        nodeId: string;
        location: VfsLocation;
        x?: number;
        y?: number;
        parentId?: string;
      };
    }
  | { type: "c2s.vfs.open"; payload: { nodeId: string } }
  | { type: "c2s.settings.update"; payload: { partial: Partial<Settings> } }
  | { type: "c2s.provider.scan"; payload: Record<string, never> }
  | { type: "c2s.notification.read"; payload: { id: string | "all" } }
  | { type: "c2s.notification.click"; payload: { id: string } }
  /** Spotlight-style app search: AI returns a list of candidate apps. */
  | { type: "c2s.app.search"; payload: { query: string; requestId: string } }
  /** Launch a (possibly brand-new) app in a fresh window, generated live. */
  | {
      type: "c2s.app.launch";
      payload: { name: string; description?: string; icon?: string };
    }
  /** Freeze a window's current UI as a reusable installed app (+ desktop shortcut). */
  | { type: "c2s.app.save"; payload: { windowId: string; name?: string; icon?: string } }
  /** Export an installed app to a shareable .vibeapp file on the desktop. */
  | { type: "c2s.app.export"; payload: { appId: string } }
  /** Import an app from a .vibeapp JSON string. */
  | { type: "c2s.app.import"; payload: { json: string } }
  | { type: "c2s.activity.fetch"; payload: { before?: number; limit?: number } };

export type ClientToServerType = ClientToServer["type"];
export type ClientToServerPayload<T extends ClientToServerType> = Extract<
  ClientToServer,
  { type: T }
>["payload"];
