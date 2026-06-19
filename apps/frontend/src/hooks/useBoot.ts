import { useEffect } from "react";
import { wsClient } from "@/lib/ws";
import { useConnectionStore } from "@/stores/connectionStore";
import { useWindowStore } from "@/stores/windowStore";
import { useAppStore } from "@/stores/appStore";
import { useVfsStore } from "@/stores/vfsStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSettingsStore, applyLocale } from "@/stores/settingsStore";
import { useActivityStore } from "@/stores/activityStore";
import { browserLocale, translate } from "@/lib/i18n";
import { ulid } from "@vibeos/shared/util";
import { applyRegions } from "@/lib/patch";

/** Connects the websocket and wires every s2c.* frame into the stores. */
export function useBoot(): void {
  useEffect(() => {
    const conn = useConnectionStore.getState();
    const win = useWindowStore.getState();
    const apps = useAppStore.getState();
    const vfs = useVfsStore.getState();
    const notif = useNotificationStore.getState();
    const settings = useSettingsStore.getState();

    const offs: Array<() => void> = [];

    offs.push(
      wsClient.onStatus((connected) => {
        conn.setConnected(connected);
        if (connected) {
          conn.setBootPhase("restoring");
          wsClient.send("c2s.boot.hello", {});
        } else {
          conn.setBootPhase("connecting");
        }
      }),
    );

    offs.push(
      wsClient.on("s2c.boot.state", (p) => {
        conn.setBootInfo({
          bootCount: p.bootCount,
          settings: p.settings,
          models: p.models,
          availableProviders: p.availableProviders,
        });
        settings.set(p.settings);
        // First boot: no language chosen yet → follow the browser and persist it
        // so AI generation (backend-side) matches the UI language too.
        if (!p.settings.locale) {
          const detected = browserLocale();
          applyLocale(detected);
          wsClient.send("c2s.settings.update", { partial: { locale: detected } });
        }
        apps.setAll(p.apps);
        vfs.setAll(p.desktopNodes);
        win.setAll(p.windows, p.snapshots);
        notif.setAll(p.notifications);
        useActivityStore.getState().setAll(p.agentRuns);
      }),
    );

    offs.push(wsClient.on("s2c.boot.ready", () => conn.setBootPhase("ready")));

    offs.push(
      wsClient.on("s2c.agent.run", (p) => useActivityStore.getState().upsert(p.run)),
      wsClient.on("s2c.activity.page", (p) =>
        useActivityStore.getState().appendPage(p.runs, p.hasMore),
      ),
    );

    offs.push(
      wsClient.on("s2c.models.updated", (p) =>
        useConnectionStore.getState().setModels(p.models),
      ),
    );

    offs.push(
      wsClient.on("s2c.providers.updated", (p) =>
        useConnectionStore.getState().setAvailableProviders(p.availableProviders),
      ),
    );

    // Surface backend errors as an error toast, localized by code (+ raw detail).
    offs.push(
      wsClient.on("s2c.error", (p) => {
        const locale = useSettingsStore.getState().settings?.locale ?? browserLocale();
        const byCode = translate(locale, `error.${p.code}`);
        const title = byCode === `error.${p.code}` ? translate(locale, "error.generic") : byCode;
        useNotificationStore.getState().push({
          id: ulid(),
          kind: "error",
          title,
          body: p.detail,
          source: "system",
          read: false,
          createdAt: Date.now(),
        });
      }),
    );

    offs.push(
      wsClient.on("s2c.ui.patch", (p) => {
        const store = useWindowStore.getState();
        if (p.mode === "full" && p.html !== undefined) {
          store.setSnapshot(p.windowId, p.html);
        } else if (p.mode === "regions" && p.regions) {
          const current = store.snapshots[p.windowId] ?? "";
          store.setSnapshot(p.windowId, applyRegions(current, p.regions));
        }
        if (p.done) store.setBusy(p.windowId, false);
      }),
    );

    offs.push(
      wsClient.on("s2c.ui.busy", (p) =>
        useWindowStore.getState().setBusy(p.windowId, p.busy),
      ),
    );

    offs.push(wsClient.on("s2c.window.opened", (p) => win.upsert(p.window)));
    offs.push(wsClient.on("s2c.window.closed", (p) => win.remove(p.windowId)));
    offs.push(wsClient.on("s2c.window.focused", (p) => win.focus(p.windowId)));
    offs.push(wsClient.on("s2c.window.moved", (p) => win.upsert(p.window)));
    offs.push(wsClient.on("s2c.window.stateChanged", (p) => win.upsert(p.window)));

    offs.push(
      wsClient.on("s2c.syscall.notify", (p) =>
        useNotificationStore.getState().push(p.notification),
      ),
    );
    offs.push(
      wsClient.on("s2c.syscall.appInstalled", (p) => {
        useAppStore.getState().upsert(p.app);
        if (p.shortcut) useVfsStore.getState().upsert(p.shortcut);
      }),
    );
    offs.push(
      wsClient.on("s2c.syscall.fileCreated", (p) =>
        useVfsStore.getState().upsert(p.node),
      ),
    );
    offs.push(
      wsClient.on("s2c.vfs.changed", (p) => useVfsStore.getState().upsert(p.node)),
    );
    offs.push(
      wsClient.on("s2c.settings.changed", (p) =>
        useSettingsStore.getState().set(p.settings),
      ),
    );
    offs.push(
      wsClient.on("s2c.notification.read", (p) =>
        useNotificationStore.getState().markRead(p.id),
      ),
    );

    wsClient.connect();

    return () => {
      for (const off of offs) off();
    };
  }, []);
}
