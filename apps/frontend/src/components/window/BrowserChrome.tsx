import { useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { wsClient } from "@/lib/ws";
import { useChromeStore } from "@/stores/chromeStore";
import { useWindowStore } from "@/stores/windowStore";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Native browser chrome: a built-in address bar + back/forward/reload, wrapping
 * the AI-generated page content. Forward (bar → AI) sends a "navigate" op;
 * reverse (AI → bar) arrives via the chrome syscall and updates the URL here.
 */
export function BrowserChrome({ windowId, children }: { windowId: string; children: ReactNode }) {
  const t = useT();
  const url = useChromeStore((s) => s.states[windowId]?.url ?? "");
  const [input, setInput] = useState(url);
  const hist = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const skipPush = useRef(false);
  const [, force] = useReducer((x) => x + 1, 0);

  // Keep the address text in sync with the (reverse-updated) URL.
  useEffect(() => setInput(url), [url]);

  // Maintain history as the URL changes — from a nav here OR from the AI — but
  // skip the change caused by a back/forward step itself.
  useEffect(() => {
    if (!url) return;
    if (skipPush.current) {
      skipPush.current = false;
      return;
    }
    const h = hist.current;
    if (h.stack[h.idx] === url) return;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(url);
    h.idx = h.stack.length - 1;
    force();
  }, [url]);

  const navigate = (target: string) => {
    const u = target.trim();
    if (!u) return;
    useChromeStore.getState().set(windowId, { url: u }); // optimistic
    useWindowStore.getState().setBusy(windowId, true);
    wsClient.send("c2s.op", {
      windowId,
      op: { kind: "submit", action: "navigate", value: u, formData: { url: u } },
    });
  };

  const step = (dir: -1 | 1) => {
    const h = hist.current;
    const next = h.idx + dir;
    if (next < 0 || next >= h.stack.length) return;
    h.idx = next;
    skipPush.current = true;
    force();
    navigate(h.stack[next]!);
  };

  const canBack = hist.current.idx > 0;
  const canFwd = hist.current.idx < hist.current.stack.length - 1;
  const btn =
    "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex h-full w-full flex-col">
      <div className="vibe-browser-bar flex shrink-0 items-center gap-1 border-b bg-card px-2 py-1.5">
        <button onClick={() => step(-1)} disabled={!canBack} title={t("browser.back")} className={btn}>
          <ArrowLeft className="size-4" />
        </button>
        <button onClick={() => step(1)} disabled={!canFwd} title={t("browser.forward")} className={btn}>
          <ArrowRight className="size-4" />
        </button>
        <button onClick={() => url && navigate(url)} title={t("browser.reload")} className={cn(btn, "mr-1")}>
          <RotateCw className="size-3.5" />
        </button>
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(input);
            (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.blur();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("browser.address")}
            spellCheck={false}
            className="vibe-browser-url h-7 w-full rounded-full border bg-background px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </form>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}
