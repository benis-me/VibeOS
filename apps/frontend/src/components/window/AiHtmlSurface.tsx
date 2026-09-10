import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { communicationCommandSchema, type AppDelivery } from "@vibeos/shared";
import { bindCommunication, sendCommunication } from "@/lib/communication";
import { useT } from "@/lib/i18n";
import type { AiOp, DragPayload } from "@vibeos/shared/protocol";
import { sanitizeAiHtml } from "@/lib/sanitize";
import { replaceRegions } from "@/lib/patch";
import { wsClient, API_BASE } from "@/lib/ws";
import { useDelegatedEvents } from "@/hooks/useDelegatedEvents";
import { useWindowStore } from "@/stores/windowStore";

interface Props {
  windowId: string;
}

/**
 * Per-window scroll position, kept module-level so it survives both innerHTML
 * full replacements and any remount.
 */
const scrollMemory = new Map<string, number>();

/** Identify an input across re-renders (name → action → placeholder). */
function inputKey(el: HTMLInputElement | HTMLTextAreaElement): string {
  return (
    el.getAttribute("name") ??
    el.dataset.vibeosAction ??
    el.getAttribute("placeholder") ??
    el.getAttribute("aria-label") ??
    ""
  );
}

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

  // Remember the user's in-progress input across re-renders so a full-replace
  // doesn't wipe what they were typing (e.g. a browser address bar).
  const preserved = useRef<{ key: string; value: string; caret: number | null } | null>(null);

  const onOp = useCallback(
    (op: AiOp) => {
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
      // Snapshot the active input before we (likely) re-render.
      const active = document.activeElement as HTMLElement | null;
      if (active && ref.current?.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) {
        const inp = active as HTMLInputElement;
        const key = inputKey(inp);
        if (key) {
          preserved.current = {
            key,
            value: inp.value,
            caret: typeof inp.selectionStart === "number" ? inp.selectionStart : null,
          };
        }
      }
      useWindowStore.getState().setBusy(windowId, true);
      wsClient.send("c2s.op", { windowId, op });
    },
    [windowId, showError],
  );

  useDelegatedEvents(ref, onOp);

  // Subscribe synchronously: React may batch renders, but no region patch may be skipped.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = (state: ReturnType<typeof useWindowStore.getState>, local: boolean) => {
      const html = state.snapshots[windowId] ?? "";
      let out = html ? sanitizeAiHtml(html) : "";
      if (API_BASE && out) out = out.replace(/(["'])\/api\/img\//g, `$1${API_BASE}/api/img/`);
      const patch = local ? state.patches[windowId] : undefined;
      const active = document.activeElement;
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
      for (const delivery of data.current.values())
        bindCommunication(el, delivery, translate.current);
      if (!state.patches[windowId]?.streaming)
        void sendCommunication(windowId, { action: "refresh" }).catch(() => {});
      const p = preserved.current;
      preserved.current = null;
      if (!p || active?.isConnected) return;
      for (const f of el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea",
      )) {
        if (inputKey(f) !== p.key) continue;
        if (patch?.mode !== "regions" && !f.value) f.value = p.value;
        if (p.caret != null) {
          try {
            f.focus({ preventScroll: true });
            f.setSelectionRange(p.caret, p.caret);
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
        (state.patches[windowId]?.mode === "regions" &&
          state.patches[windowId] !== previous.patches[windowId])
      ) {
        render(state, true);
      }
    });
  }, [windowId, showError]);

  // Retry generated images that fail to load (e.g. the held request was cut
  // short, or a transient error) instead of leaving a broken image. The image
  // streams once generation finishes, so a backed-off retry recovers it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onErr = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (img?.tagName !== "IMG" || !/\/api\/img\//.test(img.src)) return;
      const n = Number(img.dataset.vibeRetry ?? "0");
      if (n >= 6) return;
      img.dataset.vibeRetry = String(n + 1);
      const base = img.src.replace(/[?&]r=\d+$/, "");
      const sep = base.includes("?") ? "&" : "?";
      setTimeout(
        () => {
          img.src = `${base}${sep}r=${n + 1}`;
        },
        1000 + n * 1500,
      );
    };
    el.addEventListener("error", onErr, true); // capture — error doesn't bubble
    return () => el.removeEventListener("error", onErr, true);
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
      useWindowStore.getState().setBusy(windowId, true);
      wsClient.send("c2s.op.dragdrop", { windowId, source, target: { windowId } });
    },
    [windowId],
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
      <div ref={ref} onScroll={onScroll} className="ai-surface h-full w-full overflow-auto" />
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
