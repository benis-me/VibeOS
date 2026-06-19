import { create } from "zustand";
import type { Notification } from "@vibeos/shared";

interface NotificationStoreState {
  notifications: Notification[];
  /** Toasts currently visible (subset, auto-dismissed). */
  toasts: Notification[];
  setAll: (notifications: Notification[]) => void;
  push: (n: Notification) => void;
  dismissToast: (id: string) => void;
  markRead: (id: string | "all") => void;
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
  notifications: [],
  toasts: [],
  setAll: (notifications) => set({ notifications }),
  push: (n) =>
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, 100),
      toasts: [...s.toasts, n],
    })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  markRead: (id) =>
    set((s) => ({
      notifications:
        id === "all"
          ? s.notifications.map((n) => ({ ...n, read: true }))
          : s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
}));
