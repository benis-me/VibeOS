import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Minus,
  Music2,
  Plus,
  WrapText,
} from "lucide-react";
import { fileMediaType } from "@vibeos/shared";
import { fileDownloadUrl, filePreviewUrl, requestFiles } from "@/lib/files";
import { useT } from "@/lib/i18n";
import { wsClient } from "@/lib/ws";
import { clock, cn } from "@/lib/utils";
import { useWindowStore } from "@/stores/windowStore";
import { buttonVariants } from "@/components/ui/button";

const button = buttonVariants();
const tool = buttonVariants({ variant: "ghost", size: "icon" });
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
/** Room kept around an image, so "fit" never touches the window edges. */
const PAD = 24;

/** Native viewers: text is literal, media plays in place and pages through its folder. */
export function FileViewerApp({ windowId, media = false }: { windowId: string; media?: boolean }) {
  const path = useWindowStore((s) => s.windows[windowId]?.filePath);
  if (!path) return <Empty media={media} />;
  return media ? (
    <MediaViewer windowId={windowId} path={path} />
  ) : (
    <TextViewer key={path} path={path} />
  );
}

function Empty({ media }: { media: boolean }) {
  const t = useT();
  return (
    <div className="vibe-file-viewer flex h-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <FolderOpen className="size-10 text-muted-foreground/50" />
      <p className="max-w-sm text-balance text-[13px] text-muted-foreground">
        {t(media ? "viewer.mediaEmpty" : "viewer.textEmpty")}
      </p>
      <button
        type="button"
        className={button}
        onClick={() => wsClient.send("c2s.window.open", { appId: "file-manager" })}
      >
        {t("viewer.browse")}
      </button>
    </div>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="vibe-viewer-bar flex h-11 shrink-0 items-center gap-1 border-b bg-card/50 px-2">
      {children}
    </div>
  );
}

function DownloadButton({ path }: { path: string }) {
  const t = useT();
  return (
    <a
      className={tool}
      href={fileDownloadUrl(path)}
      download
      title={t("files.download")}
      aria-label={t("files.download")}
    >
      <Download className="size-4" />
    </a>
  );
}

function ViewerError({
  code,
  path,
  onRetry,
}: {
  code: string;
  path: string;
  onRetry?: () => void;
}) {
  const t = useT();
  const key = `files.error.${code}`;
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="max-w-sm text-pretty text-[13px] text-muted-foreground">
        {t(key) === key ? t("files.error.failed") : t(key)}
      </p>
      <div className="flex gap-2">
        {onRetry && (
          <button type="button" className={button} onClick={onRetry}>
            {t("viewer.retry")}
          </button>
        )}
        <a className={button} href={fileDownloadUrl(path)} download>
          <Download className="size-3.5" />
          {t("files.download")}
        </a>
      </div>
    </div>
  );
}

/**
 * Keys for a viewer, only while its window is the focused one and no field has
 * focus. A focused, zoomed image keeps its arrow keys for scrolling.
 */
function useViewerKeys(root: React.RefObject<HTMLElement | null>, onKey: (key: string) => boolean) {
  const handler = useRef(onKey);
  handler.current = onKey;
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !root.current?.closest('.vibe-window[data-focused="true"]') ||
        target?.closest("input, textarea, select, video, audio, [contenteditable='true']") ||
        (event.key.startsWith("Arrow") && target?.closest("[data-pan]"))
      )
        return;
      if (handler.current(event.key)) event.preventDefault();
    };
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, [root]);
}

function TextViewer({ path }: { path: string }) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [wrap, setWrap] = useState(true);

  useEffect(() => {
    // Text follows edits made in Files and elsewhere.
    const reload = () => setRefresh((n) => n + 1);
    const changed = wsClient.on("s2c.files.changed", reload);
    const reconnect = wsClient.on("s2c.boot.ready", reload);
    return () => {
      changed();
      reconnect();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError(null);
    requestFiles({ action: "read", path })
      .then((result) => {
        if (active) setContent(result.content ?? "");
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path, refresh]);

  // A trailing newline ends the last line rather than starting another.
  const lines = content ? content.replace(/\n$/, "").split("\n").length : 0;
  return (
    <div className="vibe-file-viewer flex h-full min-h-0 flex-col bg-background text-foreground">
      <Toolbar>
        <span className="min-w-0 flex-1 truncate px-1.5 text-xs tabular-nums text-muted-foreground">
          {content !== null && !error && `${lines.toLocaleString()} ${t("viewer.lines")}`}
        </span>
        {!error && (
          <button
            type="button"
            className={tool}
            aria-pressed={wrap}
            title={t("viewer.wrap")}
            aria-label={t("viewer.wrap")}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText className="size-4" />
          </button>
        )}
        <DownloadButton path={path} />
      </Toolbar>
      {error ? (
        <ViewerError
          code={error}
          path={path}
          onRetry={error === "binary" ? undefined : () => setRefresh((n) => n + 1)}
        />
      ) : content === null ? (
        <p role="status" className="p-4 text-xs text-muted-foreground">
          {t("files.loading")}
        </p>
      ) : (
        <textarea
          readOnly
          spellCheck={false}
          wrap={wrap ? "soft" : "off"}
          aria-label={t("files.content")}
          value={content}
          className="min-h-0 flex-1 resize-none overflow-auto bg-background p-4 font-mono text-[13px] leading-relaxed outline-none"
        />
      )}
    </div>
  );
}

function MediaViewer({ windowId, path }: { windowId: string; path: string }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const kind = fileMediaType(path)?.split("/")[0];
  const name = path.split("/").at(-1) ?? path;
  const folder = path.split("/").slice(0, -1).join("/");
  const [siblings, setSiblings] = useState<string[]>([]);
  const [listed, setListed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  // Size and length once the media has loaded, like an image's dimensions.
  const [meta, setMeta] = useState("");

  // The folder's other media, for previous/next. Disk changes refresh the list
  // without touching the file that is playing.
  useEffect(() => wsClient.on("s2c.files.changed", () => setListed((n) => n + 1)), []);
  useEffect(() => {
    let active = true;
    requestFiles({ action: "list", path: folder })
      .then((result) => {
        if (active)
          setSiblings(
            (result.entries ?? [])
              .filter((e) => e.kind === "file" && fileMediaType(e.path))
              .map((e) => e.path),
          );
      })
      .catch(() => active && setSiblings([]));
    return () => {
      active = false;
    };
  }, [folder, listed]);
  useEffect(() => {
    setFailed(false);
    setMeta("");
  }, [path]);

  const index = siblings.indexOf(path);
  const go = (step: number) => {
    const next = index < 0 ? undefined : siblings[index + step];
    if (next) void requestFiles({ action: "open", path: next, windowId });
  };
  useViewerKeys(root, (key) => {
    if (key === "ArrowLeft" || key === "ArrowRight") {
      go(key === "ArrowLeft" ? -1 : 1);
      return true;
    }
    return false;
  });

  const source = `${filePreviewUrl(path)}&v=${attempt}`;
  const nav = siblings.length > 1 && index >= 0 && (
    <>
      <button
        type="button"
        className={tool}
        disabled={index === 0}
        title={t("viewer.previous")}
        aria-label={t("viewer.previous")}
        onClick={() => go(-1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        className={tool}
        disabled={index === siblings.length - 1}
        title={t("viewer.next")}
        aria-label={t("viewer.next")}
        onClick={() => go(1)}
      >
        <ChevronRight className="size-4" />
      </button>
      <span className="px-1.5 text-xs tabular-nums text-muted-foreground">
        {index + 1} / {siblings.length}
      </span>
    </>
  );
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div
      ref={root}
      className="vibe-file-viewer flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      {failed || !kind ? (
        <>
          <Toolbar>
            {nav}
            <span className="flex-1" />
            <DownloadButton path={path} />
          </Toolbar>
          <ViewerError code="media" path={path} onRetry={kind ? retry : undefined} />
        </>
      ) : kind === "image" ? (
        <ImageView
          key={source}
          src={source}
          name={name}
          path={path}
          nav={nav}
          root={root}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <Toolbar>
            {nav}
            <span className="min-w-0 flex-1 truncate px-1.5 text-xs tabular-nums text-muted-foreground">
              {meta}
            </span>
            <DownloadButton path={path} />
          </Toolbar>
          {kind === "video" ? (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
              {/* biome-ignore lint/a11y/useMediaCaption: User files have no supplied caption track. */}
              <video
                key={source}
                src={source}
                aria-label={name}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setMeta(`${v.videoWidth} × ${v.videoHeight} · ${clock(v.duration * 1000)}`);
                }}
                onError={() => setFailed(true)}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-auto p-8">
              <div className="grid size-28 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <Music2 className="size-12" />
              </div>
              <p className="max-w-full truncate text-[13px] font-medium" title={name}>
                {name}
              </p>
              {/* biome-ignore lint/a11y/useMediaCaption: User files have no supplied caption track. */}
              <audio
                key={source}
                src={source}
                aria-label={name}
                controls
                preload="metadata"
                onLoadedMetadata={(e) => setMeta(clock(e.currentTarget.duration * 1000))}
                onError={() => setFailed(true)}
                className="w-full max-w-md"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * An image that fits the window without ever being enlarged, and zooms with the
 * toolbar, ⌘/Ctrl + wheel or a pinch (around the pointer), double-click, or
 * + / − / 0 / 1. A zoomed image pans by dragging or scrolling.
 */
function ImageView({
  src,
  name,
  path,
  nav,
  root,
  onError,
}: {
  src: string;
  name: string;
  path: string;
  nav: React.ReactNode;
  root: React.RefObject<HTMLDivElement | null>;
  onError: () => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  // null = fit, which only ever shrinks the image.
  const [zoom, setZoom] = useState<number | null>(null);
  const anchor = useRef<{ x: number; y: number; from: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = natural
    ? Math.min(1, (room.w - PAD * 2) / natural.w, (room.h - PAD * 2) / natural.h)
    : 1;
  const scale = zoom ?? Math.max(fit, 0.01);
  const current = useRef(scale);
  current.current = scale;
  const overflows =
    !!natural && (natural.w * scale + PAD * 2 > room.w || natural.h * scale + PAD * 2 > room.h);

  const zoomTo = (next: number | null, at?: { x: number; y: number }) => {
    const el = box.current;
    if (el)
      anchor.current = {
        x: at?.x ?? el.clientWidth / 2,
        y: at?.y ?? el.clientHeight / 2,
        from: current.current,
      };
    setZoom(next === null ? null : Math.min(16, Math.max(0.05, next)));
  };
  const zoomIn = () => zoomTo(ZOOMS.find((z) => z > scale + 0.001) ?? scale * 1.5);
  const zoomOut = () => zoomTo(ZOOMS.findLast((z) => z < scale - 0.001) ?? scale / 1.5);

  // Keep the point under the pointer (or the centre) in place while zooming.
  useLayoutEffect(() => {
    const el = box.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    const ratio = scale / a.from;
    el.scrollLeft = (el.scrollLeft + a.x - PAD) * ratio + PAD - a.x;
    el.scrollTop = (el.scrollTop + a.y - PAD) * ratio + PAD - a.y;
  }, [scale]);

  // A pinch arrives as Ctrl + wheel; the page itself must not zoom.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const r = el.getBoundingClientRect();
      // A wheel notch (~100) would otherwise jump ×3; a pinch sends small steps.
      const step = Math.max(-25, Math.min(25, event.deltaY));
      zoomTo(current.current * Math.exp(-step * 0.01), {
        x: event.clientX - r.left,
        y: event.clientY - r.top,
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  useViewerKeys(root, (key) => {
    if (key === "+" || key === "=") zoomIn();
    else if (key === "-" || key === "_") zoomOut();
    else if (key === "0") zoomTo(null);
    else if (key === "1") zoomTo(1);
    else return false;
    return true;
  });

  const percent = `${Math.round(scale * 100)}%`;
  return (
    <>
      <Toolbar>
        {nav}
        <span className="min-w-0 flex-1 truncate px-1.5 text-xs tabular-nums text-muted-foreground">
          {natural && `${natural.w} × ${natural.h}`}
        </span>
        <button
          type="button"
          className={tool}
          title={t("viewer.zoomOut")}
          aria-label={t("viewer.zoomOut")}
          onClick={zoomOut}
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-14 tabular-nums")}
          title={t(zoom === null ? "viewer.actualSize" : "viewer.fit")}
          aria-label={`${percent} · ${t(zoom === null ? "viewer.actualSize" : "viewer.fit")}`}
          onClick={() => zoomTo(zoom === null ? 1 : null)}
        >
          {percent}
        </button>
        <button
          type="button"
          className={tool}
          title={t("viewer.zoomIn")}
          aria-label={t("viewer.zoomIn")}
          onClick={zoomIn}
        >
          <Plus className="size-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <DownloadButton path={path} />
      </Toolbar>
      <div
        ref={box}
        data-pan={overflows || undefined}
        // Zoomed in, the image is a scroll area keyboard users can focus and pan.
        tabIndex={overflows ? 0 : undefined}
        role="group"
        aria-label={name}
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-muted/40",
          overflows && "cursor-grab active:cursor-grabbing",
        )}
        onDoubleClick={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          const at = { x: event.clientX - r.left, y: event.clientY - r.top };
          zoomTo(zoom !== null ? null : fit < 1 ? 1 : 2, at);
        }}
        onPointerDown={(event) => {
          const el = box.current;
          if (!el || !overflows || event.button !== 0) return;
          // Leave the scrollbars to the browser.
          const r = el.getBoundingClientRect();
          if (event.clientX - r.left > el.clientWidth || event.clientY - r.top > el.clientHeight)
            return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
          };
          el.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const el = box.current;
          const d = drag.current;
          if (!el || !d) return;
          el.scrollLeft = d.left - (event.clientX - d.x);
          el.scrollTop = d.top - (event.clientY - d.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div className="flex min-h-full min-w-full w-max" style={{ padding: PAD }}>
          <img
            src={src}
            alt={name}
            draggable={false}
            onLoad={(event) =>
              setNatural({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            onError={onError}
            style={natural ? { width: natural.w * scale, height: natural.h * scale } : undefined}
            className={cn(
              "m-auto max-w-none select-none outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
              !natural && "invisible",
            )}
          />
        </div>
      </div>
    </>
  );
}
