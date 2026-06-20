import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, Loader2, LayoutGrid, AppWindow } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import type { AppSearchResult } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";
import { ulid } from "@vibeos/shared/util";
import { useT } from "@/lib/i18n";
import { usePopoverMotion, useOverlayMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Mac-Spotlight-style AI app search. */
export function Spotlight({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AppSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef<string>("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useT();

  // Focus the box and reset when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Receive search results that match our latest request.
  useEffect(() => {
    return wsClient.on("s2c.app.searchResults", (p) => {
      if (p.requestId !== reqId.current) return;
      setResults(p.results);
      setActive(0);
      setLoading(false);
    });
  }, []);

  // Debounced search as the user types.
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(() => {
      const id = ulid();
      reqId.current = id;
      wsClient.send("c2s.app.search", { query: q, requestId: id });
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, open]);

  const overlay = useOverlayMotion();
  const panel = usePopoverMotion();

  const launch = (r: AppSearchResult, asWidget = false) => {
    wsClient.send("c2s.app.launch", {
      name: r.name,
      description: r.description,
      icon: r.icon,
      widget: asWidget,
    });
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active];
      // Enter launches in the result's suggested form; Shift+Enter flips it.
      if (r) launch(r, e.shiftKey ? r.kind !== "widget" : r.kind === "widget");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          {...overlay}
          className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/30 pt-[18vh] backdrop-blur-sm"
          onPointerDown={onClose}
        >
          <motion.div
            {...panel}
            className="w-[min(620px,92vw)] overflow-hidden rounded-2xl border bg-popover/95 shadow-2xl sheen"
            onPointerDown={(e) => e.stopPropagation()}
          >
        <div className="flex items-center gap-3 px-4">
          {loading ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-5 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("spotlight.placeholder")}
            className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
        </div>

        {results.length > 0 && (
          <>
            <div className="max-h-80 overflow-auto border-t p-1.5">
              {results.map((r, i) => {
                const isWidget = r.kind === "widget";
                return (
                  <div
                    key={`${r.name}-${i}`}
                    onPointerEnter={() => setActive(i)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-lg pl-3 pr-1.5 transition-colors",
                      i === active ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    {/* Launch in the result's suggested form (app or widget). */}
                    <button
                      onClick={() => launch(r, isWidget)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                    >
                      <AppIcon name={r.icon} label={r.name} className="size-6" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        {r.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.description}
                          </span>
                        )}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5 pr-1">
                      {/* Override: launch in the other form. */}
                      <button
                        onClick={() => launch(r, !isWidget)}
                        title={isWidget ? t("spotlight.openAsApp") : t("spotlight.openAsWidget")}
                        className={cn(
                          "rounded-md border p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                          i === active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        {isWidget ? <AppWindow className="size-3" /> : <LayoutGrid className="size-3" />}
                      </button>
                      {/* Type badge — what a normal click does. */}
                      <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {isWidget ? <LayoutGrid className="size-3" /> : <AppWindow className="size-3" />}
                        {isWidget ? t("spotlight.kindWidget") : t("spotlight.kindApp")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Legend: Enter launches in the shown form, Shift+Enter flips it. */}
            <div className="flex items-center justify-end gap-4 border-t px-4 py-1.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border bg-muted px-1 font-sans">↵</kbd>
                {t("spotlight.open")}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border bg-muted px-1 font-sans">⇧↵</kbd>
                {t("spotlight.switchKind")}
              </span>
            </div>
          </>
        )}

        {query.trim().length >= 2 && !loading && results.length === 0 && (
          <div className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
            {t("spotlight.noResults")}
          </div>
        )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
