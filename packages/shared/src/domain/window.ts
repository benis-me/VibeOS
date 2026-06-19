export type WindowKind = "app" | "system" | "widget";
export type WindowDisplayState = "normal" | "minimized" | "maximized";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowState {
  id: string;
  appId: string;
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
