import { create } from "zustand";
import type { ApplicationState } from "@vibeos/shared";

export const useApplicationStore = create<
  ApplicationState & {
    selectedId?: string;
    sourceWindowId?: string;
    set: (state: ApplicationState) => void;
    select: (id: string, sourceWindowId?: string) => void;
  }
>((set) => ({
  applications: [],
  set: (state) => set(state),
  select: (selectedId, sourceWindowId) => set({ selectedId, sourceWindowId }),
}));
