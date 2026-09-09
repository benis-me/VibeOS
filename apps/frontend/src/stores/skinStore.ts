import { create } from "zustand";
import {
  compileSkin,
  isBuiltinSkin,
  type Skin,
  type SkinState,
  type SkinRequest,
  type SkinCommand,
} from "@vibeos/shared";
import { wsClient, API_BASE } from "@/lib/ws";

export const useSkinStore = create<
  SkinState & {
    drafts: Record<string, string>;
    set: (state: SkinState) => void;
    progress: (request: SkinRequest) => void;
    draft: (id: string, text: string) => void;
  }
>((set) => ({
  skins: [],
  drafts: {},
  set: (state) => {
    set(state);
    applySkin((document.documentElement.dataset.selectedSkin ?? "devdock") as Skin);
  },
  progress: (request) =>
    set((state) => ({
      skins: state.skins.map((skin) =>
        skin.id === request.skinId
          ? {
              ...skin,
              requests: skin.requests.some((r) => r.id === request.id)
                ? skin.requests.map((r) => (r.id === request.id ? request : r))
                : [...skin.requests, request],
            }
          : skin,
      ),
    })),
  draft: (id, text) => set((state) => ({ drafts: { ...state.drafts, [id]: text } })),
}));

export function applySkin(id: Skin): void {
  const root = document.documentElement;
  root.dataset.selectedSkin = id;
  const skin = useSkinStore.getState().skins.find((s) => s.id === id);
  const previous = document.getElementById("vibeos-custom-skin");
  if (isBuiltinSkin(id) || !skin || skin.loadError) {
    previous?.remove();
    delete root.dataset.customSkin;
    root.dataset.skin = isBuiltinSkin(id) ? id : "devdock";
    return;
  }
  const css = compileSkin(id, skin.definition, API_BASE);
  const style = previous ?? document.createElement("style");
  style.id = "vibeos-custom-skin";
  style.textContent = css;
  if (!previous) document.head.appendChild(style);
  root.dataset.skin = skin.foundation ?? id;
  root.dataset.customSkin = id;
}

export function sendSkinCommand(command: SkinCommand): Promise<Skin | undefined> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const off = wsClient.on("s2c.skin.result", (result) => {
      if (result.requestId !== requestId) return;
      clearTimeout(timer);
      off();
      if (result.error) reject(new Error(result.error));
      else resolve(result.skinId);
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error("skins.error.timeout"));
    }, 15000);
    wsClient.send("c2s.skin.command", { requestId, command });
  });
}
