import { create } from "zustand";
import type { VfsNode } from "@vibeos/shared";

interface VfsStoreState {
  nodes: Record<string, VfsNode>;
  setAll: (nodes: VfsNode[]) => void;
  upsert: (node: VfsNode) => void;
  desktop: () => VfsNode[];
  recyclebin: () => VfsNode[];
}

export const useVfsStore = create<VfsStoreState>((set, get) => ({
  nodes: {},
  setAll: (nodes) =>
    set(() => {
      const map: Record<string, VfsNode> = {};
      for (const n of nodes) map[n.id] = n;
      return { nodes: map };
    }),
  upsert: (node) => set((s) => ({ nodes: { ...s.nodes, [node.id]: node } })),
  desktop: () =>
    Object.values(get().nodes).filter((n) => n.location === "desktop"),
  recyclebin: () =>
    Object.values(get().nodes).filter((n) => n.location === "recyclebin"),
}));
