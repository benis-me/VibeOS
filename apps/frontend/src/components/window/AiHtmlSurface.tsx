import { useCallback, useLayoutEffect, useRef } from "react";
import type { AiOp, DragPayload } from "@vibeos/shared/protocol";
import { sanitizeAiHtml } from "@/lib/sanitize";
import { wsClient, API_BASE } from "@/lib/ws";
import { useDelegatedEvents } from "@/hooks/useDelegatedEvents";
import { useWindowStore } from "@/stores/windowStore";

interface Props {
  windowId: string;
  html: string;
}

/**
 * Per-window scroll position, kept module-level so it survives both innerHTML
 * rebuilds (every patch/full render replaces the content) and any remount.
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
export function AiHtmlSurface({ windowId, html }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const busy = useWindowStore((s) => s.busy[windowId]);

  // Remember the user's in-progress input across re-renders so a full-replace
  // doesn't wipe what they were typing (e.g. a browser address bar).
  const preserved = useRef<{ key: string; value: string; caret: number | null } | null>(null);

  const onOp = useCallback(
    (op: AiOp) => {
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
    [windowId],
  );

  useDelegatedEvents(ref, onOp);

  // Inject the sanitized HTML ONLY when it actually changes — never on a plain
  // re-render (window drag / focus / z-order). Setting innerHTML rebuilds the
  // whole DOM subtree (which resets scroll and costs CPU), so gating it on
  // [html] keeps drags smooth and scroll stable, and means other windows
  // re-rendering can't disturb this one. /api/img paths are rewritten to the
  // backend origin (in dev the backend is on a different port than Vite).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let out = html ? sanitizeAiHtml(html) : "";
    if (API_BASE && out) out = out.replace(/(["'])\/api\/img\//g, `$1${API_BASE}/api/img/`);
    el.innerHTML = out;
  }, [html]);

  // Remember the scroll position as the user scrolls.
  const onScroll = useCallback(() => {
    if (ref.current) scrollMemory.set(windowId, ref.current.scrollTop);
  }, [windowId]);

  // After every render (a patch replaces innerHTML → scrollTop snaps to 0; a
  // focus change can remount the surface), put the scroll back. Guarded so it
  // only undoes a reset, never fights live scrolling. The saved value lives in
  // the module-level map, so it deliberately survives unmount/remount — we do
  // NOT clear it on unmount, or a remount would lose the position.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollMemory.get(windowId);
    if (saved && el.scrollTop === 0) el.scrollTop = saved;
  });

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

  // After the HTML is applied, restore a preserved input value if the AI's new
  // markup left the matching field blank (so navigation/search keep your text).
  useLayoutEffect(() => {
    const p = preserved.current;
    if (!p || !ref.current) return;
    preserved.current = null;
    const fields = ref.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    for (const f of fields) {
      if (inputKey(f) === p.key && !f.value) {
        f.value = p.value;
        if (p.caret != null && "setSelectionRange" in f) {
          try {
            f.focus();
            f.setSelectionRange(p.caret, p.caret);
          } catch {
            /* ignore */
          }
        }
        break;
      }
    }
  }, [html]);

  return (
    <div className="relative h-full w-full overflow-hidden" onDragOver={onDragOver} onDrop={onDrop}>
      {/* OS-style loading bar pinned to the top while the AI is working.
          No text — the bar alone communicates activity, like a native shell. */}
      {busy && <ProgressBar />}

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
