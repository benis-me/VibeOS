import { useEffect, useState } from "react";
import {
  Download,
  FileText,
  FolderOpen,
  Image,
  Music2,
  RefreshCw,
  WrapText,
  ZoomIn,
} from "lucide-react";
import { fileMediaType } from "@vibeos/shared";
import { fileDownloadUrl, filePreviewUrl, requestFiles } from "@/lib/files";
import { useT } from "@/lib/i18n";
import { wsClient } from "@/lib/ws";
import { useWindowStore } from "@/stores/windowStore";

const button =
  "vibe-btn inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent";

/** Native viewers share chrome; text is literal, media uses browser controls. */
export function FileViewerApp({ windowId, media = false }: { windowId: string; media?: boolean }) {
  const path = useWindowStore((s) => s.windows[windowId]?.filePath);
  return <Viewer key={path} path={path} media={media} />;
}

function Viewer({ path, media }: { path?: string; media: boolean }) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [fit, setFit] = useState(true);
  const kind = path ? fileMediaType(path)?.split("/")[0] : undefined;
  const name = path?.split("/").at(-1);

  useEffect(() => {
    const reload = () => setRefresh((n) => n + 1);
    // Text follows edits in Files. Unrelated disk writes must not restart playback.
    const changed = !media ? wsClient.on("s2c.files.changed", reload) : () => {};
    const reconnect = wsClient.on("s2c.boot.ready", reload);
    return () => {
      changed();
      reconnect();
    };
  }, [media]);

  useEffect(() => {
    if (!path) return;
    setError(null);
    if (media) return;
    let active = true;
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
  }, [path, media, refresh]);

  const errorKey = `files.error.${error}`;
  const source = path ? `${filePreviewUrl(path)}&v=${refresh}` : undefined;
  return (
    <div className="vibe-file-viewer flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b bg-card/50 px-3 py-2">
        {media ? (
          <Image className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs" title={path ? `/${path}` : undefined}>
          {name ?? t(media ? "viewer.media" : "viewer.text")}
        </span>
        {path && (
          <>
            {!media && (
              <button
                className={button}
                aria-pressed={wrap}
                title={t("viewer.wrap")}
                onClick={() => setWrap(!wrap)}
              >
                <WrapText className="size-3.5" />
              </button>
            )}
            {kind === "image" && (
              <button className={button} aria-pressed={!fit} onClick={() => setFit(!fit)}>
                <ZoomIn className="size-3.5" />
                {t(fit ? "viewer.actualSize" : "viewer.fit")}
              </button>
            )}
            <button
              className={button}
              title={t("files.refresh")}
              onClick={() => setRefresh((n) => n + 1)}
            >
              <RefreshCw className="size-3.5" />
            </button>
            <a className={button} href={fileDownloadUrl(path)} download title={t("files.download")}>
              <Download className="size-3.5" />
            </a>
          </>
        )}
      </div>
      {!path ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-sm text-muted-foreground">
          <FolderOpen className="size-10 opacity-40" />
          <p>{t(media ? "viewer.mediaEmpty" : "viewer.textEmpty")}</p>
          <button
            className={button}
            onClick={() => wsClient.send("c2s.window.open", { appId: "file-manager" })}
          >
            {t("viewer.browse")}
          </button>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
        >
          {t(errorKey) === errorKey ? t("files.error.failed") : t(errorKey)}
        </div>
      ) : !media ? (
        content === null ? (
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
            className="min-h-0 flex-1 resize-none overflow-auto bg-background p-4 font-mono text-[13px] leading-relaxed"
          />
        )
      ) : kind === "image" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <img
            key={source}
            src={source}
            alt={name}
            onError={() => setError("media")}
            className={fit ? "h-full w-full object-contain" : "mx-auto max-w-none"}
          />
        </div>
      ) : kind === "audio" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto p-6">
          <Music2 className="size-14 shrink-0 text-muted-foreground/50" />
          {/* biome-ignore lint/a11y/useMediaCaption: User files have no supplied caption track. */}
          <audio
            key={source}
            src={source}
            aria-label={name}
            controls
            preload="metadata"
            onError={() => setError("media")}
            className="w-full max-w-lg"
          />
        </div>
      ) : kind === "video" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
          {/* biome-ignore lint/a11y/useMediaCaption: User files have no supplied caption track. */}
          <video
            key={source}
            src={source}
            aria-label={name}
            controls
            playsInline
            preload="metadata"
            onError={() => setError("media")}
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <p role="alert" className="p-6 text-sm text-muted-foreground">
          {t("files.error.media")}
        </p>
      )}
    </div>
  );
}
