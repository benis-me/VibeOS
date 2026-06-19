import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, Loader2 } from "lucide-react";
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

  const launch = (r: AppSearchResult) => {
    wsClient.send("c2s.app.launch", {
      name: r.name,
      description: r.description,
      icon: r.icon,
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
      if (r) launch(r);
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
          <div className="max-h-80 overflow-auto border-t p-1.5">
            {results.map((r, i) => (
              <button
                key={`${r.name}-${i}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => launch(r)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
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
                {i === active && (
                  <span className="text-[10px] text-muted-foreground">{t("spotlight.open")}</span>
                )}
              </button>
            ))}
          </div>
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
