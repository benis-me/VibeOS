import { useMemo } from "react";
import { Trash, FileText, FolderSimple, ArrowCounterClockwise } from "@phosphor-icons/react";
import type { AppDescriptor, VfsNode } from "@vibeos/shared";
import { AppIcon } from "@/components/AppIcon";
import { useVfsStore } from "@/stores/vfsStore";
import { useAppStore } from "@/stores/appStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";

type T = (k: string) => string;

/** Native Recycle Bin — view, restore, or permanently delete trashed items. */
export function RecycleBinApp() {
  const t = useT();
  const nodes = useVfsStore((s) => s.nodes);
  const apps = useAppStore((s) => s.apps);
  const items = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => n.location === "recyclebin")
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [nodes],
  );

  const restore = (id: string) =>
    wsClient.send("c2s.vfs.move", { nodeId: id, location: "desktop" });
  const remove = (id: string) => wsClient.send("c2s.vfs.delete", { nodeId: id });
  const empty = () => wsClient.send("c2s.vfs.empty", {});

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Trash weight="duotone" className="size-4" />
          {t("recyclebin.title")}
          {items.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">
              {items.length} {t("recyclebin.items")}
            </span>
          )}
        </div>
        <button
          onClick={empty}
          disabled={items.length === 0}
          className="vibe-btn rounded-lg border bg-card px-2.5 py-1.5 text-[12px] transition-colors hover:bg-accent disabled:opacity-40"
        >
          {t("recyclebin.emptyAll")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Trash weight="duotone" className="size-7 opacity-40" />
            <span className="text-sm">{t("recyclebin.empty")}</span>
          </div>
        ) : (
          items.map((n) => (
            <Row
              key={n.id}
              node={n}
              apps={apps}
              t={t}
              onRestore={() => restore(n.id)}
              onDelete={() => remove(n.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  node,
  apps,
  t,
  onRestore,
  onDelete,
}: {
  node: VfsNode;
  apps: Record<string, AppDescriptor>;
  t: T;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const app = apps[node.targetAppId ?? ""];
  const icon =
    node.type === "shortcut" ? (
      <AppIcon
        name={app?.icon ?? (node.meta.icon as string)}
        presetId={app?.presetId}
        label={app?.name ?? node.name}
        className="size-6"
      />
    ) : node.type === "folder" ? (
      <FolderSimple weight="duotone" className="size-6" />
    ) : (
      <FileText weight="duotone" className="size-6" />
    );

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-5 py-2.5 transition-colors hover:bg-accent/30">
      <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{node.name}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={onRestore}
          className="vibe-btn flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] transition-colors hover:bg-accent"
        >
          <ArrowCounterClockwise className="size-3.5" /> {t("recyclebin.restore")}
        </button>
        <button
          onClick={onDelete}
          title={t("recyclebin.delete")}
          className="vibe-btn rounded-md border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-destructive hover:text-white"
        >
          <Trash className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
