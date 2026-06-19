import { useRef } from "react";
import { FileText, FolderSimple } from "@phosphor-icons/react";
import { AppIcon } from "@/components/AppIcon";
import type { VfsNode } from "@vibeos/shared";
import { useAppStore } from "@/stores/appStore";
import { useVfsStore } from "@/stores/vfsStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { desktopItemMenu } from "@/components/contextmenu/menus";
import { snapToGrid } from "@/lib/desktopGrid";

export function DesktopIcon({ node }: { node: VfsNode }) {
  const apps = useAppStore((s) => s.apps);
  const t = useT();
  const dragging = useRef(false);
  const moved = useRef(false);

  const open = () => {
    if (moved.current) return;
    wsClient.send("c2s.vfs.open", { nodeId: node.id });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { px: e.clientX, py: e.clientY, x: node.x ?? 24, y: node.y ?? 24 };
    dragging.current = true;
    moved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
      useVfsStore.getState().upsert({
        ...node,
        x: Math.max(8, start.x + dx),
        y: Math.max(8, start.y + dy),
      });
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved.current) {
        const cur = useVfsStore.getState().nodes[node.id];
        if (cur) {
          // Snap to the grid on release.
          const { x, y } = snapToGrid(cur.x ?? 24, cur.y ?? 24);
          useVfsStore.getState().upsert({ ...cur, x, y });
          wsClient.send("c2s.vfs.move", { nodeId: node.id, location: "desktop", x, y });
        }
        setTimeout(() => (moved.current = false), 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const shortcutApp = apps[node.targetAppId ?? ""];
  const icon =
    node.type === "shortcut" ? (
      <AppIcon
        name={shortcutApp?.icon ?? (node.meta.icon as string)}
        presetId={shortcutApp?.presetId}
        label={shortcutApp?.name ?? node.name}
        className="size-7"
      />
    ) : node.type === "folder" ? (
      <FolderSimple weight="duotone" className="size-7" />
    ) : (
      <FileText weight="duotone" className="size-7" />
    );

  return (
    <button
      onPointerDown={onPointerDown}
      onDoubleClick={open}
      onContextMenu={(e) => openContextMenu(e, desktopItemMenu({ t, node }))}
      className="absolute flex w-20 touch-none flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/10"
      style={{ left: node.x ?? 24, top: node.y ?? 24 }}
    >
      <span className="flex size-10 items-center justify-center text-3xl leading-none">
        {icon}
      </span>
      <span className="line-clamp-2 text-[11px] text-foreground/90 drop-shadow">
        {node.name}
      </span>
    </button>
  );
}
