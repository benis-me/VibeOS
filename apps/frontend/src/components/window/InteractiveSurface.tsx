import { useEffect, useMemo, useRef, useState } from "react";
import { runtimeMessageSchema } from "@vibeos/shared/protocol";
import { viewStateSchema, type ViewState } from "@vibeos/shared";
import { sendCommunication } from "@/lib/communication";
import { wsClient, API_BASE } from "@/lib/ws";
import { useWindowStore } from "@/stores/windowStore";
import { useT } from "@/lib/i18n";
import { runtimeTheme, runtimeBaseStyle } from "@/runtime/theme";

export function InteractiveSurface({ windowId }: { windowId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const t = useT();
  const translate = useRef(t);
  translate.current = t;
  const [error, setError] = useState("");
  const [booting, setBooting] = useState(true);
  const [requests, setRequests] = useState(0);
  const [reload, setReload] = useState(0);
  const win = useWindowStore((s) => s.windows[windowId]);
  const busy = useWindowStore((s) => s.busy[windowId]);
  const view = useRef<ViewState>(win?.viewState ?? {});
  const srcDoc = useMemo(() => {
    const nonce = crypto.randomUUID();
    const base = API_BASE || location.origin;
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const baseStyle = runtimeBaseStyle(document.body).replace(/</g, "\\3c ");
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob: ${base}/api/img/; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; object-src 'none'`;
    // Intersect policies so a script cannot reuse its nonce to load arbitrary URLs.
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' ${escape(base)}/api/app-runtime.js"><style id="theme">${baseStyle}</style></head><body><main id="surface" class="ai-surface"></main><script nonce="${nonce}" src="${escape(base)}/api/app-runtime.js"></script></body></html>`;
  }, [windowId, win?.appVersionId, reload]);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    setRequests(0);
    setBooting(true);
    let port: MessagePort | undefined;
    let disposed = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let themeTimer: ReturnType<typeof setTimeout> | undefined;
    let themeSeq = 0;
    const version = useWindowStore.getState().windows[windowId]?.appVersionId;
    const save = () =>
      wsClient.send("c2s.window.view-state", {
        windowId,
        appVersionId: version,
        state: view.current,
      });
    const send = (data: unknown) => {
      if (!disposed) port?.postMessage(data);
    };
    const render = (local: boolean) => {
      const store = useWindowStore.getState();
      let html = store.snapshots[windowId] ?? "";
      if (API_BASE) html = html.replace(/(["'])\/api\/img\//g, `$1${API_BASE}/api/img/`);
      send({
        type: "render",
        html,
        patch: local
          ? store.patches[windowId]
          : {
              windowId,
              mode: "full",
              streaming: store.patches[windowId]?.streaming ?? false,
              dataVersion:
                store.patches[windowId]?.dataVersion ??
                store.windows[windowId]?.snapshotDataVersion,
            },
      });
      setError("");
    };
    const status = () => {
      const s = useWindowStore.getState();
      send({
        type: "status",
        visible: s.windows[windowId]?.state !== "minimized" && !document.hidden,
        busy: !!s.busy[windowId],
      });
    };
    const theme = () => {
      clearTimeout(themeTimer);
      themeTimer = setTimeout(async () => {
        const seq = ++themeSeq;
        if (!container.current) return;
        try {
          const value = await runtimeTheme(container.current, API_BASE);
          if (seq === themeSeq) send(value);
        } catch {
          /* Existing font fallback stays usable. */
        }
      }, 40);
    };
    const refresh = () => void sendCommunication(windowId, { action: "refresh" }).catch(() => {});
    const timer = setTimeout(() => {
      if (!port) {
        setBooting(false);
        setError(translate.current("runtime.error.start"));
      }
    }, 15000);
    const ready = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.data?.type !== "vibeos.ready" || port)
        return;
      clearTimeout(timer);
      setBooting(false);
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = ({ data }) => {
        const parsed = runtimeMessageSchema.safeParse(data);
        if (!parsed.success || disposed) {
          if (!disposed) setError(translate.current("communication.invalid"));
          return;
        }
        const message = parsed.data;
        if (message.type === "op") {
          view.current = viewStateSchema.parse(message.op.viewState ?? view.current);
          if (
            wsClient.send("c2s.op", {
              windowId,
              op: { ...message.op, viewState: view.current },
            })
          )
            useWindowStore.getState().setBusy(windowId, true);
          else setError(translate.current("communication.disconnected"));
        } else if (message.type === "view") {
          if (JSON.stringify(view.current) === JSON.stringify(message.state)) return;
          view.current = message.state;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(save, 150);
        } else if (message.type === "command") {
          setRequests((n) => n + 1);
          void sendCommunication(windowId, message.command)
            .then(
              (value) => send({ type: "result", id: message.id, value }),
              (e) =>
                send({
                  type: "result",
                  id: message.id,
                  error: e instanceof Error ? e.message : String(e),
                }),
            )
            .finally(() => {
              if (!disposed) setRequests((n) => n - 1);
            });
        } else if (message.type === "focus") {
          if (!useWindowStore.getState().windows[windowId]?.focused)
            wsClient.send("c2s.window.focus", { windowId });
        } else if (message.type === "context") {
          const rect = iframe.getBoundingClientRect();
          iframe.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + Math.max(0, Math.min(rect.width, message.x)),
              clientY: rect.top + Math.max(0, Math.min(rect.height, message.y)),
            }),
          );
        } else if (message.type === "shortcut") {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: message.key,
              code: message.key === " " ? "Space" : "KeyK",
              ctrlKey: message.ctrl,
              metaKey: message.meta,
            }),
          );
        } else if (message.type === "drop") {
          wsClient.send("c2s.op.dragdrop", {
            windowId,
            source: message.source,
            target: { windowId },
          });
        } else if (message.type === "error") setError(message.message);
      };
      port.start();
      iframe.contentWindow!.postMessage(
        {
          type: "vibeos.connect",
          windowId,
          state: view.current,
          dataVersion: useWindowStore.getState().windows[windowId]?.snapshotDataVersion,
        },
        "*",
        [channel.port2],
      );
      theme();
      status();
      render(false);
      refresh();
    };
    window.addEventListener("message", ready);
    document.addEventListener("visibilitychange", status);
    const offStore = useWindowStore.subscribe((s, previous) => {
      if (!port) return;
      if (
        s.snapshots[windowId] !== previous.snapshots[windowId] ||
        s.patches[windowId] !== previous.patches[windowId]
      ) {
        render(true);
        if (!s.patches[windowId]?.streaming) refresh();
      }
      if (
        s.windows[windowId]?.state !== previous.windows[windowId]?.state ||
        s.busy[windowId] !== previous.busy[windowId]
      )
        status();
    });
    const offDelivery = wsClient.on("s2c.communication.delivery", ({ delivery }) => {
      if (delivery.windowId === windowId && delivery.mode === "data")
        send({
          type: "delivery",
          delivery,
          errorText: delivery.error ? translate.current(delivery.error) : undefined,
        });
    });
    const reconnect = wsClient.on("s2c.boot.ready", refresh);
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(saveTimer);
      clearTimeout(themeTimer);
      save();
      send({ type: "dispose" });
      disposed = true;
      port?.close();
      observer.disconnect();
      offStore();
      offDelivery();
      reconnect();
      window.removeEventListener("message", ready);
      document.removeEventListener("visibilitychange", status);
    };
  }, [windowId, win?.appVersionId, srcDoc]);
  return (
    <div ref={container} className="relative h-full w-full overflow-hidden">
      {(booting || busy || requests > 0) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-foreground/10">
          <div className="vibeos-progress h-full w-2/5 bg-brand" />
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b bg-background px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-destructive" title={error}>
            {error}
          </span>
          <button
            className="vibe-btn rounded border px-2 py-1"
            onClick={() => {
              setError("");
              if (
                wsClient.send("c2s.op", {
                  windowId,
                  op: {
                    kind: "custom",
                    action: "repair-runtime",
                    value: error,
                    viewState: view.current,
                  },
                })
              )
                useWindowStore.getState().setBusy(windowId, true);
            }}
          >
            {t("runtime.repair")}
          </button>
          <button
            className="vibe-btn rounded border px-2 py-1"
            onClick={() => {
              setError("");
              setReload((n) => n + 1);
            }}
          >
            {t("runtime.reload")}
          </button>
        </div>
      )}
      <iframe
        ref={frame}
        title={`${win?.title ?? ""} ${t("runtime.content")}`}
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        className="h-full w-full border-0"
      />
    </div>
  );
}
