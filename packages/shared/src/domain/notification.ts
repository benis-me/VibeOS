export type NotificationKind = "info" | "success" | "warning" | "error";
export type NotificationSource = "syscall" | "agent" | "system";

export interface NotificationAction {
  label: string;
  /** e.g. open an app. */
  openAppId?: string;
}

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  appId?: string;
  source: NotificationSource;
  read: boolean;
  action?: NotificationAction;
  createdAt: number;
}
