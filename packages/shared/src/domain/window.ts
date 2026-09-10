export type WindowKind = "app" | "system" | "widget";
export type WindowDisplayState = "normal" | "minimized" | "maximized";

export interface WindowSize {
  w: number;
  h: number;
}

export interface Rect extends WindowSize {
  x: number;
  y: number;
}

export interface WindowState {
  /** Open file on the system disk; persisted across reconnects and restarts. */
  filePath?: string;
  id: string;
  appId: string;
  appVersionId?: string;
  title: string;
  kind: WindowKind;
  rect: Rect;
  z: number;
  state: WindowDisplayState;
  isOpen: boolean;
  focused: boolean;
  /** Dock / taskbar position (left → right). */
  order: number;
  openedAt: number;
  updatedAt: number;
}
