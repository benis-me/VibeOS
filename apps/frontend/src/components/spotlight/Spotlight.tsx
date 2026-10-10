import { useEffect, useId, useMemo, useRef, useState, Fragment, type ReactNode } from "react";
import { Search, Loader2, LayoutGrid, AppWindow, Sparkles, ChevronRight } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import type { AppDescriptor, AppSearchResult, WindowState } from "@vibeos/shared";
import { wsClient } from "@/lib/ws";
import { ulid } from "@vibeos/shared/util";
import { appLabel, translate, useLocale, useT } from "@/lib/i18n";
import { isComposing } from "@/lib/fields";
import { useAppStore } from "@/stores/appStore";
import { useWindowStore } from "@/stores/windowStore";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Prefilled on open (e.g. a "> command" from the welcome screen). */
  initialQuery?: string;
}

interface LocalMatch {
  app: AppDescriptor;
  /** Its frontmost open window: switching to it beats opening another. */
  win: WindowState | undefined;
}

/**
 * Mac-Spotlight-style launcher, local first: existing apps match instantly, then
 * "generate this" launches the description right away; AI ideas load below.
 */
export function Spotlight({ open, onClose, initialQuery = "" }: Props) {
  const [query, setQuery] = useState("");
  // AI ideas and the highlighted row remember the query they belong to, so a
  // keystroke that changes the query drops both within the same render.
  const [ideas, setIdeas] = useState({ q: "", list: [] as AppSearchResult[], failed: false });
  const [selected, setSelected] = useState({ q: "", index: 0 });
  const [running, setRunning] = useState(false);
  const [cmdError, setCmdError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const request = useRef({ id: "", q: "" });
  const cmdReqId = useRef<string>("");
  const appMap = useAppStore((s) => s.apps);
  const locale = useLocale();
  const t = useT();
  const listId = useId();

  // A leading ">" switches from app search to AI command mode (Raycast/VS Code
  // convention): the rest of the line is a natural-language instruction the AI
  // executes against the system.
  const isCommand = query.trimStart().startsWith(">");
  const commandText = query.replace(/^\s*>\s*/, "");
  const q = isCommand ? "" : query.trim();

  // Installed apps (plus unsaved ones still open) whose name contains the query.
  // Windows are read, not subscribed: dragging a window must not re-render this.
  const local = useMemo<LocalMatch[]>(() => {
    const needle = q.toLowerCase();
    if (!needle) return [];
    const windows = Object.values(useWindowStore.getState().windows).sort((a, b) => b.z - a.z);
    return Object.values(appMap)
      .flatMap((app) => {
        const win = windows.find((w) => w.appId === app.id);
        if (app.id === "__transient__" || !(app.isInstalled || win)) return [];
        const names = [
          app.name,
          app.presetId ? translate(locale, `preset.${app.presetId}`) : "",
        ].map((name) => name.toLowerCase());
        const rank = names.some((name) => name.startsWith(needle))
          ? 0
          : names.some((name) => name.includes(needle))
            ? 1
            : -1;
        return rank < 0 ? [] : [{ app, win, rank }];
      })
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5);
  }, [q, appMap, locale]);
  const results = ideas.q === q ? ideas.list : [];
  const failed = ideas.q === q && ideas.failed;
  const loading = q.length >= 2 && ideas.q !== q;
  const active = selected.q === q ? selected.index : 0;
  const setActive = (index: number) => setSelected({ q, index });
  // Row order: local matches, the generate row, then AI ideas.
  const ideasFrom = local.length + 1;

  // Focus the box and reset when opened, seeding any prefilled query.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setRunning(false);
      setCmdError("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, initialQuery]);

  // AI command finished: close on success (the AI's own notify syscall surfaces
  // the result); on failure stay open and say why.
  useEffect(
    () =>
      wsClient.on("s2c.command.result", (p) => {
        if (p.requestId !== cmdReqId.current) return;
        setRunning(false);
        if (p.error) setCmdError(p.error);
        else onClose();
      }),
    [onClose],
  );

  // AI ideas for our latest request. Rows above them keep their places.
  useEffect(() => {
    return wsClient.on("s2c.app.searchResults", (p) => {
      if (p.requestId !== request.current.id) return;
      // Group by type for sectioned display: apps first, then widgets (sort is
      // stable, so the model's order within each group is preserved).
      const list = [...p.results].sort(
        (a, b) => (a.kind === "widget" ? 1 : 0) - (b.kind === "widget" ? 1 : 0),
      );
      setIdeas({ q: request.current.q, list, failed: !!p.error });
    });
  }, []);

  // Debounced AI ideas for the current query.
  useEffect(() => {
    if (!open || q.length < 2) return;
    const timer = setTimeout(() => {
      request.current = { id: ulid(), q };
      wsClient.send("c2s.app.search", { query: q, requestId: request.current.id });
    }, 350);
    return () => clearTimeout(timer);
  }, [q, open]);

  const run = (i: number) => {
    const match = local[i];
    const idea = results[i - ideasFrom];
    if (match?.win) wsClient.send("c2s.window.focus", { windowId: match.win.id });
    else if (match) wsClient.send("c2s.window.open", { appId: match.app.id });
    else if (i === local.length)
      // Generate straight from the description, without waiting for AI ideas.
      wsClient.send("c2s.app.launch", {
        name: q.slice(0, 40),
        description: q.length > 40 ? q : undefined,
      });
    else if (idea)
      // Each idea launches in the form the model assigned it — no toggling.
      wsClient.send("c2s.app.launch", {
        name: idea.name,
        description: idea.description,
        icon: idea.icon,
        widget: idea.kind === "widget",
        size: idea.defaultSize,
      });
    else return;
    onClose();
  };

  const runCommandPalette = () => {
    const text = commandText.trim();
    if (!text || running) return;
    const id = ulid();
    cmdReqId.current = id;
    setRunning(true);
    setCmdError("");
    wsClient.send("c2s.command.run", { text, requestId: id });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // While an IME composes (pinyin), Enter/Escape belong to it.
    if (isComposing(e.nativeEvent)) return;
    if (e.key === "Escape") return onClose();
    if (isCommand) {
      if (e.key === "Enter") {
        e.preventDefault();
        runCommandPalette();
      }
      return;
    }
    if (!q) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(active + 1, ideasFrom + results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    }
  };

  // A launcher summoned many times a day by its shortcut opens and closes with no
  // animation (as Raycast does): the user already knows where it appears.
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/30 pt-[18vh] backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("startmenu.appSearch")}
        className="w-[min(620px,92vw)] overflow-hidden rounded-2xl border bg-popover/95 shadow-popover inset-shadow-sheen"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4">
          {running ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
          ) : isCommand ? (
            <ChevronRight className="size-5 shrink-0 text-brand" />
          ) : (
            <Search className="size-5 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCmdError("");
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={!!q}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={q ? `${listId}-${active}` : undefined}
            placeholder={t("spotlight.placeholder")}
            className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
        </div>

        {isCommand && (
          <div className="border-t p-1.5">
            <button
              onClick={runCommandPalette}
              disabled={!commandText.trim() || running}
              className="flex w-full items-center gap-3 rounded-lg bg-accent px-3 py-2.5 text-left text-accent-foreground disabled:opacity-60"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {running ? t("spotlight.cmdRunning") : t("spotlight.cmdRun")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {commandText.trim() || t("spotlight.cmdHint")}
                </span>
              </span>
              <kbd className="rounded border bg-muted px-1 font-sans text-2xs text-muted-foreground">
                ↵
              </kbd>
            </button>
            {cmdError && (
              <div role="alert" className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs">
                {/* A known reason is shown translated; anything else (model or
                        provider failure) points at the model services. */}
                <span className="min-w-0 flex-1 text-destructive">
                  {t(cmdError) === cmdError ? t("spotlight.cmdFailed") : t(cmdError)}
                </span>
                {t(cmdError) === cmdError && (
                  <button
                    type="button"
                    onClick={() => {
                      wsClient.send("c2s.window.open", { appId: "settings" });
                      onClose();
                    }}
                    className="vibe-btn shrink-0 rounded border px-2 py-1"
                  >
                    {t("settings.open")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {q && (
          <div
            id={listId}
            role="listbox"
            aria-label={t("startmenu.appSearch")}
            className="max-h-80 overflow-auto border-t p-1.5"
          >
            {local.length > 0 && <Heading icon={AppWindow} label={t("spotlight.local")} />}
            {local.map(({ app, win }, i) => (
              <Row
                key={app.id}
                id={`${listId}-${i}`}
                active={i === active}
                onHover={() => setActive(i)}
                onClick={() => run(i)}
                icon={
                  <AppIcon
                    name={app.icon}
                    presetId={app.presetId}
                    label={appLabel(t, app)}
                    className="size-6"
                  />
                }
                title={appLabel(t, app)}
                detail={app.manifest.description === app.name ? "" : app.manifest.description}
                badge={win ? t("spotlight.opened") : ""}
              />
            ))}
            <Row
              id={`${listId}-${local.length}`}
              active={active === local.length}
              onHover={() => setActive(local.length)}
              onClick={() => run(local.length)}
              icon={
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
                  <Sparkles className="size-3.5" />
                </span>
              }
              title={q}
              detail={t("spotlight.generate")}
            />
            {results.map((r, j) => {
              const isWidget = r.kind === "widget";
              return (
                <Fragment key={`${r.name}-${j}`}>
                  {/* results are sorted by kind, so a header shows at each boundary. */}
                  {results[j - 1]?.kind !== r.kind && (
                    <Heading
                      icon={isWidget ? LayoutGrid : AppWindow}
                      label={isWidget ? t("spotlight.kindWidget") : t("spotlight.kindApp")}
                    />
                  )}
                  <Row
                    id={`${listId}-${ideasFrom + j}`}
                    active={ideasFrom + j === active}
                    onHover={() => setActive(ideasFrom + j)}
                    onClick={() => run(ideasFrom + j)}
                    icon={<AppIcon name={r.icon} label={r.name} className="size-6" />}
                    title={r.name}
                    detail={r.description}
                  />
                </Fragment>
              );
            })}
            {(loading || failed) && (
              <div
                role="status"
                className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground"
              >
                {loading && <Loader2 className="size-3.5 animate-spin" />}
                {loading ? t("spotlight.thinking") : t("spotlight.searchFailed")}
              </div>
            )}
          </div>
        )}

        {!isCommand && (
          <div className="flex items-center gap-1.5 border-t px-4 py-1.5 text-2xs text-muted-foreground">
            <kbd className="rounded border bg-muted px-1 font-sans">&gt;</kbd>
            {t("spotlight.cmdMode")}
          </div>
        )}
      </div>
    </div>
  );
}

function Heading({ icon: Icon, label }: { icon: typeof AppWindow; label: string }) {
  return (
    <div
      role="presentation"
      className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-2xs font-medium text-muted-foreground"
    >
      <Icon className="size-3" />
      {label}
    </div>
  );
}

function Row(props: {
  id: string;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  detail?: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      id={props.id}
      role="option"
      aria-selected={props.active}
      tabIndex={-1}
      onPointerEnter={props.onHover}
      onClick={props.onClick}
      className={cn(
        // Hover and arrow-key selection move the highlight instantly.
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        props.active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      {props.icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{props.title}</span>
        {props.detail && (
          <span className="block truncate text-xs text-muted-foreground">{props.detail}</span>
        )}
      </span>
      {props.badge && (
        <span className="shrink-0 text-2xs text-muted-foreground">{props.badge}</span>
      )}
    </button>
  );
}
