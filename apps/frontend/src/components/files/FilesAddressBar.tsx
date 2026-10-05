import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  HardDrive,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { SYSTEM_FOLDERS } from "@vibeos/shared";
import { useT } from "@/lib/i18n";

const control =
  "vibe-files-nav-btn grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-30";
/** Inside the 32px location field: 24px, with a radius concentric to the field's 8px. */
const inner =
  "grid size-6 shrink-0 place-items-center rounded-[4px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-30";
const crumb =
  "flex h-6 shrink-0 items-center gap-1.5 rounded-[4px] px-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function FilesAddressBar({
  path,
  busy,
  loading,
  canBack,
  canForward,
  onBack,
  onForward,
  onUp,
  onNavigate,
  onRefresh,
  directories,
  children,
}: {
  path: string;
  busy: boolean;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavigate: (address: string) => Promise<boolean>;
  onRefresh: () => void;
  directories: string[];
  /** Folder actions and search, so Files keeps a single toolbar row. */
  children?: React.ReactNode;
}) {
  const t = useT();
  const locationsId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(`/${path}`);
  const [copied, setCopied] = useState(false);
  const edit = useCallback(() => {
    setAddress(`/${path}`);
    setEditing(true);
    input.current?.focus();
    input.current?.select();
  }, [path]);
  useEffect(() => {
    setAddress(`/${path}`);
  }, [path]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (busy || !root.current?.closest('.vibe-window[data-focused="true"]')) return;
      if (
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") ||
        (event.altKey && event.key.toLowerCase() === "d")
      ) {
        event.preventDefault();
        edit();
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        if (canBack) onBack();
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        if (canForward) onForward();
      } else if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        if (path) onUp();
      } else if (event.key === "F5") {
        event.preventDefault();
        onRefresh();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, canBack, canForward, path, onBack, onForward, onUp, onRefresh, edit]);
  const parts = path.split("/").filter(Boolean);
  return (
    <div
      ref={root}
      className="vibe-files-addressbar flex h-11 shrink-0 items-center gap-2 border-b bg-card/50 px-3"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={control}
          title={t("files.historyBack")}
          disabled={busy || !canBack}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          className={control}
          title={t("files.historyForward")}
          disabled={busy || !canForward}
          onClick={onForward}
        >
          <ArrowRight className="size-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          className={control}
          title={t("files.up")}
          disabled={busy || !path}
          onClick={onUp}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
      {/* The location keeps its room; secondary controls give way in a narrow window.
          It matches the toolbar's 32px fields and rings only while a path is typed. */}
      <div className="vibe-files-location flex h-8 min-w-28 flex-1 items-center gap-1 rounded-md border bg-background pr-1 has-[input:focus]:ring-2 has-[input:focus]:ring-ring/40">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onNavigate(address)) {
                setEditing(false);
              }
            }}
          >
            <input
              ref={input}
              aria-label={t("files.path")}
              list={locationsId}
              value={address}
              maxLength={4096}
              disabled={busy}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                  setAddress(`/${path}`);
                }
              }}
              className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-xs outline-none"
            />
            <datalist id={locationsId}>
              {Array.from(new Set([...SYSTEM_FOLDERS, ...directories])).map((directory) => (
                <option key={directory} value={`/${directory}`} />
              ))}
            </datalist>
            <button
              type="submit"
              className={inner}
              title={t("files.go")}
              aria-label={t("files.go")}
              disabled={busy}
            >
              <ArrowRight className="size-3.5" />
            </button>
          </form>
        ) : (
          <>
            <nav
              aria-label={t("files.breadcrumbs")}
              className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 text-xs [scrollbar-width:none]"
              onDoubleClick={edit}
            >
              <button
                type="button"
                className={crumb}
                disabled={busy}
                title={t("files.disk")}
                aria-label={t("files.disk")}
                onClick={() => void onNavigate("/")}
              >
                <HardDrive className="size-3.5" />
                {!path && t("files.disk")}
              </button>
              {parts.map((part, index) => (
                <span
                  key={parts.slice(0, index + 1).join("/")}
                  className="flex min-w-0 shrink-0 items-center gap-0.5"
                >
                  <ChevronRight className="size-3 text-muted-foreground/50" />
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={index === parts.length - 1 ? "page" : undefined}
                    title={part}
                    onClick={() => void onNavigate(`/${parts.slice(0, index + 1).join("/")}`)}
                    className="block h-6 max-w-36 truncate rounded-[4px] px-1.5 leading-6 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </nav>
            <button
              type="button"
              className={inner}
              title={t("files.editPath")}
              aria-label={t("files.editPath")}
              disabled={busy}
              onClick={edit}
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        className={`${control} @max-lg:hidden`}
        title={t(copied ? "files.pathCopied" : "files.copyPath")}
        disabled={busy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`/${path}`);
            setCopied(true);
          } catch {
            edit();
          }
        }}
      >
        {copied ? <Check className="size-4 text-foreground" /> : <Copy className="size-4" />}
      </button>
      <button
        type="button"
        className={control}
        title={t("files.refresh")}
        disabled={busy}
        onClick={onRefresh}
      >
        <RefreshCw
          className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
      </button>
      {children}
      <span role="status" className="sr-only">
        {copied ? t("files.pathCopied") : ""}
      </span>
    </div>
  );
}
