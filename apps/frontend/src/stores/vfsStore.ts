import { create } from "zustand";
import type { VfsNode } from "@vibeos/shared";

interface VfsStoreState {
  nodes: Record<string, VfsNode>;
  setAll: (nodes: VfsNode[]) => void;
  upsert: (node: VfsNode) => void;
  remove: (ids: string[]) => void;
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
  remove: (ids) =>
    set((s) => {
      const nodes = { ...s.nodes };
      for (const id of ids) delete nodes[id];
      return { nodes };
    }),
  desktop: () =>
    Object.values(get().nodes).filter((n) => n.location === "desktop"),
  recyclebin: () =>
    Object.values(get().nodes).filter((n) => n.location === "recyclebin"),
}));
