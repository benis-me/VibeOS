import { create } from "zustand";
import type { AppDescriptor } from "@vibeos/shared";

interface AppStoreState {
  apps: Record<string, AppDescriptor>;
  setAll: (apps: AppDescriptor[]) => void;
  upsert: (app: AppDescriptor) => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  apps: {},
  setAll: (apps) =>
    set(() => {
      const map: Record<string, AppDescriptor> = {};
      for (const a of apps) map[a.id] = a;
      return { apps: map };
    }),
  upsert: (app) => set((s) => ({ apps: { ...s.apps, [app.id]: app } })),
}));
