import { create } from "zustand";
import type { BootPhase, Settings, ModelInfo, ProviderId } from "@vibeos/shared";

interface ConnectionState {
  connected: boolean;
  bootPhase: BootPhase;
  bootCount: number;
  settings: Settings | null;
  models: ModelInfo[];
  availableProviders: ProviderId[];
  setConnected: (v: boolean) => void;
  setBootPhase: (p: BootPhase) => void;
  setBootInfo: (info: {
    bootCount: number;
    settings: Settings;
    models: ModelInfo[];
    availableProviders: ProviderId[];
  }) => void;
  setModels: (models: ModelInfo[]) => void;
  setAvailableProviders: (providers: ProviderId[]) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connected: false,
  bootPhase: "connecting",
  bootCount: 0,
  settings: null,
  models: [],
  availableProviders: [],
  setConnected: (v) => set({ connected: v }),
  setBootPhase: (p) => set({ bootPhase: p }),
  setBootInfo: (info) =>
    set({
      bootCount: info.bootCount,
      settings: info.settings,
      models: info.models,
      availableProviders: info.availableProviders,
    }),
  setModels: (models) => set({ models }),
  setAvailableProviders: (availableProviders) => set({ availableProviders }),
}));
