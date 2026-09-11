import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  communicationCommandSchema,
  viewStateSchema,
  type AppDelivery,
  type ViewState,
} from "@vibeos/shared";
import { bindCommunication, sendCommunication } from "@/lib/communication";
import { useT } from "@/lib/i18n";
import type { AiOp, DragPayload } from "@vibeos/shared/protocol";
import { sanitizeAiHtml } from "@/lib/sanitize";
import { replaceRegions } from "@/lib/patch";
import { wsClient, API_BASE } from "@/lib/ws";
import { useDelegatedEvents } from "@/hooks/useDelegatedEvents";
import { useWindowStore } from "@/stores/windowStore";
import { createDrafts, fieldKey, type Field } from "@/lib/fields";
import { installImageRetries } from "@/lib/imageRetry";
import { runPrepared, restorePrepared } from "@/lib/preparedInteractions";

interface Props {
  windowId: string;
}

/**
 * Per-window scroll position, kept module-level so it survives both innerHTML
 * full replacements and any remount.
 */
const scrollMemory = new Map<string, number>();

/**
 * Renders sanitized AI-generated HTML and routes all interactions back to the
 * backend as operations. The AI never gets to run code in the shell.
 */
export function AiHtmlSurface({ windowId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const [communicationError, setCommunicationError] = useState("");
  const [requests, setRequests] = useState(0);
  const data = useRef(new Map<string, AppDelivery>());
  const initial = useWindowStore.getState().windows[windowId];
  const view = useRef<ViewState>(initial?.viewState ?? {});
  const dataVersion = useRef(initial?.snapshotDataVersion);
  const currentDataVersion = useRef<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveView = useCallback(() => {
    wsClient.send("c2s.window.view-state", {
      windowId,
      appVersionId: useWindowStore.getState().windows[windowId]?.appVersionId,
      state: view.current,
    });
  }, [windowId]);
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      saveView();
    },
    [saveView],
  );
  const translate = useRef(t);
  translate.current = t;
  const showError = useCallback((e: unknown) => {
    const key =
      e instanceof Error && /^(communication|files.error|skins.error)\.[a-zA-Z]+$/.test(e.message)
        ? e.message
        : "communication.invalid";
    setCommunicationError(key);
  }, []);
  useEffect(() => {
    const off = wsClient.on("s2c.communication.delivery", ({ delivery }) => {
      if (delivery.windowId !== windowId || delivery.mode !== "data") return;
      if (
        delivery.channel === "appData" &&
        delivery.data &&
        typeof delivery.data === "object" &&
        !Array.isArray(delivery.data)
      )
        currentDataVersion.current = String(delivery.data.version);
      if (delivery.channel) {
        data.current.delete(delivery.channel);
        data.current.set(delivery.channel, delivery);
        if (data.current.size > 32) data.current.delete(data.current.keys().next().value!);
      }
      if (ref.current) bindCommunication(ref.current, delivery, translate.current);
    });
    const reconnect = wsClient.on("s2c.boot.ready", () => {
      void sendCommunication(windowId, { action: "refresh" }).catch(() => {});
    });
    return () => {
      off();
      reconnect();
    };
  }, [windowId, showError]);
  const busy = useWindowStore((s) => s.busy[windowId]);

  const drafts = useRef(createDrafts()).current;

  const onOp = useCallback(
    (op: AiOp, scope: HTMLElement) => {
      const directive = op.dataset?.vibeosCommand;
      if (directive) {
        try {
          const raw = JSON.parse(directive);
          if (op.formData && Object.keys(op.formData).length)
            raw.data = {
              ...(raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
                ? raw.data
                : {}),
              ...op.formData,
            };
          const command = communicationCommandSchema.parse(raw);
          setCommunicationError("");
          setRequests((n) => n + 1);
          void sendCommunication(windowId, command)
            .catch(showError)
            .finally(() => setRequests((n) => n - 1));
        } catch (e) {
          showError(e);
        }
        return;
      }
      if (
        wsClient.send("c2s.op", {
          windowId,
          op: { ...op, viewState: view.current },
        })
      ) {
        if (op.id) drafts.submit(op.id, op.formData ?? {}, scope);
        useWindowStore.getState().setBusy(windowId, true);
      } else showError(new Error("communication.disconnected"));
    },
    [windowId, showError, drafts],
  );

  const onLocal = useCallback(
    (el: HTMLElement, op: AiOp) => {
      if (!ref.current) return false;
      const next = runPrepared(
        ref.current,
        el,
        op.value,
        view.current,
        !useWindowStore.getState().busy[windowId] &&
          !!dataVersion.current &&
          dataVersion.current === currentDataVersion.current,
      );
      if (!next) return false;
      const parsed = viewStateSchema.safeParse(next);
      if (!parsed.success) return false;
      view.current = parsed.data;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveView, 150);
      return true;
    },
    [windowId, saveView],
  );
  useDelegatedEvents(ref, onOp, drafts, onLocal);

  // Subscribe synchronously: React may batch renders, but no region patch may be skipped.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = (state: ReturnType<typeof useWindowStore.getState>, local: boolean) => {
      const html = state.snapshots[windowId] ?? "";
      let out = html ? sanitizeAiHtml(html, windowId) : "";
      if (API_BASE && out) out = out.replace(/(["'])\/api\/img\//g, `$1${API_BASE}/api/img/`);
      const patch = local ? state.patches[windowId] : undefined;
      const active = document.activeElement;
      const focused =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
          ? {
              key: fieldKey(active),
              start: active.selectionStart,
              end: active.selectionEnd,
            }
          : null;
      const scroll = el.scrollTop || scrollMemory.get(windowId) || 0;
      if (patch?.mode === "regions") {
        // Sanitize the complete document first; sanitizing a bare <tr> drops its context.
        const next = document.createElement("div");
        next.innerHTML = out;
        try {
          replaceRegions(
            el,
            (patch.regions ?? []).map(({ region }) => {
              const target = next.querySelector(`[data-vibeos-region="${CSS.escape(region)}"]`);
              if (!target) throw new Error(`Sanitized region missing: ${region}`);
              return { region, html: target.outerHTML };
            }),
          );
        } catch {
          el.innerHTML = out;
        }
      } else {
        el.innerHTML = out;
      }
      el.scrollTop = scroll;
      if (!patch) dataVersion.current = state.windows[windowId]?.snapshotDataVersion;
      else if (
        !patch.streaming &&
        (patch.dataVersion !== undefined || patch.mode === "full" || patch.regions?.length)
      )
        dataVersion.current = patch.dataVersion;
      for (const delivery of data.current.values())
        bindCommunication(el, delivery, translate.current);
      if (!state.patches[windowId]?.streaming)
        void sendCommunication(windowId, { action: "refresh" }).catch(() => {});
      drafts.restore(el, patch?.done ? patch.operationId : undefined);
      restorePrepared(el, view.current);
      if (!focused || active?.isConnected) return;
      for (const f of el.querySelectorAll<Field>("input, textarea")) {
        if (fieldKey(f) !== focused.key) continue;
        if (
          focused.start != null &&
          (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement)
        ) {
          try {
            f.focus({ preventScroll: true });
            (f as HTMLInputElement).setSelectionRange(focused.start, focused.end);
          } catch {
            /* Some input types do not support selection. */
          }
        }
        break;
      }
    };
    render(useWindowStore.getState(), false);
    return useWindowStore.subscribe((state, previous) => {
      if (
        state.snapshots[windowId] !== previous.snapshots[windowId] ||
        state.patches[windowId] !== previous.patches[windowId]
      ) {
        render(state, true);
      }
    });
  }, [windowId, showError, drafts]);

  useEffect(() => {
    if (ref.current) return installImageRetries(ref.current);
  }, []);

  // Remember the scroll position as the user scrolls.
  const onScroll = useCallback(() => {
    if (ref.current) scrollMemory.set(windowId, ref.current.scrollTop);
  }, [windowId]);

  // Drop TARGET: accept a drag from any app (or the OS) and route it to the
  // backend, which asks the agent to react to it.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      let source: DragPayload | null = null;
      const raw = dt.getData("application/x-vibeos-drag");
      if (raw) {
        try {
          source = JSON.parse(raw) as DragPayload;
        } catch {
          /* ignore */
        }
      }
      if (!source && dt.files.length) {
        const f = dt.files[0]!;
        source = { kind: "file", ref: f.name, label: f.name };
      }
      if (!source) {
        const val = (dt.getData("text/uri-list") || dt.getData("text/plain")).trim();
        if (val) source = { kind: "text", ref: val, label: val.slice(0, 80) };
      }
      if (!source?.ref) return;
      if (
        wsClient.send("c2s.op.dragdrop", {
          windowId,
          source,
          target: { windowId },
        })
      )
        useWindowStore.getState().setBusy(windowId, true);
      else showError(new Error("communication.disconnected"));
    },
    [windowId, showError],
  );

  return (
    <div className="relative h-full w-full overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
      {/* OS-style loading bar pinned to the top while the AI is working.
          No text — the bar alone communicates activity, like a native shell. */}
      {(busy || requests > 0) && <ProgressBar />}
      {communicationError && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b bg-background px-3 py-2 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1">{t(communicationError)}</span>
          <button
            type="button"
            onClick={() => setCommunicationError("")}
            aria-label={t("communication.dismiss")}
            className="vibe-btn rounded border px-2 py-1"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* The delegation root is mounted UNCONDITIONALLY (not gated on `html`) so
          useDelegatedEvents can bind its listeners at mount. If it only appeared
          after the first generation, the effect's deps ([ref, onOp]) would never
          change, so it would never re-run to attach listeners to the freshly
          mounted node — and a brand-new window would ignore every click until a
          page refresh re-mounted it with html already present.
          h-full (not min-h-full) gives the AI root a *definite* parent height,
          so its `height:100%` resolves and fills the window vertically.
          overflow-auto here is the scroll fallback if the AI content is taller. */}
      <div
        ref={ref}
        data-ai-window={windowId}
        onScroll={onScroll}
        style={{ contain: "layout paint style", isolation: "isolate" }}
        className="ai-surface h-full w-full overflow-auto"
      />
    </div>
  );
}

/** Indeterminate top progress bar, like a real OS/browser loading indicator. */
function ProgressBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-foreground/10">
      <div className="vibeos-progress h-full w-2/5 bg-brand" />
    </div>
  );
}
