import { create } from "zustand";
import type { SystemMemoryState } from "@vibeos/shared";

export const useMemoryStore = create<
  SystemMemoryState & {
    set: (state: SystemMemoryState) => void;
  }
>((set) => ({ enabled: false, revision: 0, entries: [], set: (state) => set(state) }));
