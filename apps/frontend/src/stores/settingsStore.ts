import { create } from "zustand";
import type { Settings, Theme, Locale, Skin, ProviderId, ProviderModel } from "@vibeos/shared";
import { DEFAULT_SKIN } from "@vibeos/shared";

interface SettingsStoreState {
  settings: Settings | null;
  set: (settings: Settings) => void;
  /** Patch one API provider's model list (after a live "Fetch models"). */
  setProviderModels: (providerId: ProviderId, models: ProviderModel[]) => void;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  settings: null,
  set: (settings) => {
    applyTheme(settings.theme);
    applySkin(settings.skin ?? DEFAULT_SKIN);
    if (settings.locale) applyLocale(settings.locale);
    set({ settings });
  },
  setProviderModels: (providerId, models) =>
    set((s) => {
      if (!s.settings) return s;
      const apiProviders = { ...s.settings.apiProviders };
      apiProviders[providerId] = { ...apiProviders[providerId], models };
      return { settings: { ...s.settings, apiProviders } };
    }),
}));

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
}

export function applySkin(skin: Skin): void {
  document.documentElement.dataset.skin = skin;
}
