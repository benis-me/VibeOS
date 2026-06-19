import { create } from "zustand";
import type { BootPhase, Settings, ModelInfo, ProviderId, ProviderModel } from "@vibeos/shared";

interface ConnectionState {
  connected: boolean;
  bootPhase: BootPhase;
  bootCount: number;
  version: string;
  settings: Settings | null;
  models: ModelInfo[];
  /** Discovered models per provider (ephemeral; for the model pickers). */
  providerModels: Record<string, ProviderModel[]>;
  availableProviders: ProviderId[];
  setConnected: (v: boolean) => void;
  setBootPhase: (p: BootPhase) => void;
  setBootInfo: (info: {
    bootCount: number;
    version: string;
    settings: Settings;
    models: ModelInfo[];
    availableProviders: ProviderId[];
  }) => void;
  setModels: (models: ModelInfo[]) => void;
  setProviderModels: (providerId: string, models: ProviderModel[]) => void;
  setAvailableProviders: (providers: ProviderId[]) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  connected: false,
  bootPhase: "connecting",
  bootCount: 0,
  version: "",
  settings: null,
  models: [],
  providerModels: {},
  availableProviders: [],
  setConnected: (v) => set({ connected: v }),
  setBootPhase: (p) => set({ bootPhase: p }),
  setBootInfo: (info) =>
    set({
      bootCount: info.bootCount,
      version: info.version,
      settings: info.settings,
      models: info.models,
      availableProviders: info.availableProviders,
    }),
  setModels: (models) => set({ models }),
  setProviderModels: (providerId, models) =>
    set((s) => ({ providerModels: { ...s.providerModels, [providerId]: models } })),
  setAvailableProviders: (availableProviders) => set({ availableProviders }),
}));
