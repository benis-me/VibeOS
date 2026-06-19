import {
  Search,
  AppWindow,
  Palette,
  Settings as SettingsIcon,
  Activity,
  Minus,
  Square,
  Copy,
  X,
  Save,
  RotateCw,
  FolderOpen,
  Download,
  Trash2,
} from "lucide-react";
import type { AppDescriptor, Skin, Theme, WindowState, VfsNode } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";
import type { MenuItem } from "./ContextMenu";

type WinCtl = "c2s.window.minimize" | "c2s.window.maximize" | "c2s.window.close" | "c2s.app.save";
const openApp = (appId: string) => wsClient.send("c2s.window.open", { appId });
const winMsg = (type: WinCtl, windowId: string) => wsClient.send(type, { windowId });
const setPref = (partial: Record<string, unknown>) =>
  wsClient.send("c2s.settings.update", { partial });

type T = (k: string) => string;

/** Right-click on the desktop background. */
export function desktopMenu(o: {
  t: T;
  apps: AppDescriptor[];
  skin: Skin;
  theme: Theme;
  onAppSearch: () => void;
}): MenuItem[] {
  return [
    { type: "item", label: o.t("startmenu.appSearch"), icon: <Search size={15} />, onSelect: o.onAppSearch },
    {
      type: "submenu",
      label: o.t("menu.openApp"),
      icon: <AppWindow size={15} />,
      items: o.apps.map((a) => ({ type: "item", label: a.name, onSelect: () => openApp(a.id) })),
    },
    { type: "separator" },
    {
      type: "submenu",
      label: o.t("settings.cat.appearance"),
      icon: <Palette size={15} />,
      items: [
        { type: "item", label: o.t("settings.skin.default"), checked: o.skin === "devdock", onSelect: () => setPref({ skin: "devdock" }) },
        { type: "item", label: "Windows XP", checked: o.skin === "xp", onSelect: () => setPref({ skin: "xp" }) },
        { type: "item", label: "Mac Aqua", checked: o.skin === "aqua", onSelect: () => setPref({ skin: "aqua" }) },
        { type: "separator" },
        { type: "item", label: o.t("settings.theme.light"), checked: o.theme === "light", onSelect: () => setPref({ theme: "light" }) },
        { type: "item", label: o.t("settings.theme.dark"), checked: o.theme === "dark", onSelect: () => setPref({ theme: "dark" }) },
      ],
    },
    { type: "item", label: o.t("settings.title"), icon: <SettingsIcon size={15} />, onSelect: () => openApp("settings") },
    { type: "item", label: o.t("menu.activity"), icon: <Activity size={15} />, onSelect: () => openApp("activity-monitor") },
  ];
}

/** Right-click on a window title bar. */
export function windowMenu(o: { t: T; win: WindowState; native: boolean }): MenuItem[] {
  const maximized = o.win.state === "maximized";
  return [
    { type: "item", label: o.t("win.minimize"), icon: <Minus size={15} />, onSelect: () => winMsg("c2s.window.minimize", o.win.id) },
    {
      type: "item",
      label: maximized ? o.t("win.restore") : o.t("win.maximize"),
      icon: maximized ? <Copy size={14} /> : <Square size={13} />,
      onSelect: () => winMsg("c2s.window.maximize", o.win.id),
    },
    ...(o.native
      ? []
      : ([
          { type: "separator" },
          { type: "item", label: o.t("win.saveAsApp"), icon: <Save size={14} />, onSelect: () => winMsg("c2s.app.save", o.win.id) },
        ] as MenuItem[])),
    { type: "separator" },
    { type: "item", label: o.t("win.close"), icon: <X size={14} />, danger: true, onSelect: () => winMsg("c2s.window.close", o.win.id) },
  ];
}

/** Right-click on a taskbar / Dock window button. */
export function taskbarItemMenu(o: { t: T; win: WindowState }): MenuItem[] {
  const minimized = o.win.state === "minimized";
  return [
    {
      type: "item",
      label: minimized ? o.t("win.restore") : o.t("win.minimize"),
      icon: minimized ? <Copy size={14} /> : <Minus size={15} />,
      onSelect: () =>
        minimized
          ? wsClient.send("c2s.window.focus", { windowId: o.win.id })
          : winMsg("c2s.window.minimize", o.win.id),
    },
    { type: "item", label: o.t("win.maximize"), icon: <Square size={13} />, onSelect: () => winMsg("c2s.window.maximize", o.win.id) },
    { type: "separator" },
    { type: "item", label: o.t("win.close"), icon: <X size={14} />, danger: true, onSelect: () => winMsg("c2s.window.close", o.win.id) },
  ];
}

/** Right-click on a desktop item (shortcut / file / folder). */
export function desktopItemMenu(o: { t: T; node: VfsNode }): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: "item",
      label: o.t("store.open"),
      icon: <FolderOpen size={15} />,
      onSelect: () => wsClient.send("c2s.vfs.open", { nodeId: o.node.id }),
    },
  ];
  if (o.node.type === "shortcut" && o.node.targetAppId) {
    const appId = o.node.targetAppId;
    items.push({
      type: "item",
      label: o.t("store.export"),
      icon: <Download size={14} />,
      onSelect: () => wsClient.send("c2s.app.export", { appId }),
    });
  }
  items.push({ type: "separator" });
  items.push({
    type: "item",
    label: o.t("menu.delete"),
    icon: <Trash2 size={14} />,
    danger: true,
    onSelect: () => wsClient.send("c2s.vfs.move", { nodeId: o.node.id, location: "recyclebin" }),
  });
  return items;
}

/** Right-click on empty taskbar space. */
export function taskbarMenu(o: { t: T }): MenuItem[] {
  return [
    { type: "item", label: o.t("menu.activity"), icon: <Activity size={15} />, onSelect: () => openApp("activity-monitor") },
    { type: "item", label: o.t("settings.title"), icon: <SettingsIcon size={15} />, onSelect: () => openApp("settings") },
  ];
}

/** Right-click inside an app's content. */
export function appContentMenu(o: { t: T; win: WindowState; native: boolean }): MenuItem[] {
  const items: MenuItem[] = [];
  if (!o.native) {
    items.push({
      type: "item",
      label: o.t("menu.reload"),
      icon: <RotateCw size={14} />,
      onSelect: () => wsClient.send("c2s.op", { windowId: o.win.id, op: { kind: "custom", action: "reload" } }),
    });
    items.push({ type: "item", label: o.t("win.saveAsApp"), icon: <Save size={14} />, onSelect: () => winMsg("c2s.app.save", o.win.id) });
    items.push({ type: "separator" });
  }
  items.push({ type: "item", label: o.t("win.close"), icon: <X size={14} />, danger: true, onSelect: () => winMsg("c2s.window.close", o.win.id) });
  return items;
}
