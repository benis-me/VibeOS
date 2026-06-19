import { create } from "zustand";
import type { DragPayload } from "@vibeos/shared/protocol";

interface DragStoreState {
  payload: DragPayload | null;
  start: (payload: DragPayload) => void;
  end: () => void;
}

export const useDragStore = create<DragStoreState>((set) => ({
  payload: null,
  start: (payload) => set({ payload }),
  end: () => set({ payload: null }),
}));
