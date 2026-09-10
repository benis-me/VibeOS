import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CornerUpRight,
  ArrowUp,
  Check,
  Copy,
  Download,
  File,
  FilePlus,
  FilePenLine,
  Folder,
  FolderPlus,
  HardDrive,
  Pencil,
  Save,
  Trash2,
  Upload,
  Send,
  X,
} from "lucide-react";
import {
  FILE_UPLOAD_LIMIT,
  fileMediaType,
  resolveDiskAddress,
  SYSTEM_FOLDERS,
  type DiskCommand,
  type FileRequestCommand,
  type DiskEntry,
} from "@vibeos/shared";
import { requestFiles, fileDownloadUrl } from "@/lib/files";
import { sendCommunication } from "@/lib/communication";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { useWindowStore } from "@/stores/windowStore";
import { wsClient } from "@/lib/ws";
import { useChromeStore } from "@/stores/chromeStore";
import { FilesAddressBar } from "./FilesAddressBar";
import { AppIcon } from "@/components/AppIcon";
import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";

const button =
  "vibe-btn inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-40";
const input =
  "vibe-input min-w-0 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const parent = (path: string) => path.split("/").slice(0, -1).join("/");
const child = (path: string, name: string) => (path ? `${path}/${name}` : name);
type Editor = {
  path: string;
  content: string;
  saved: string;
  version?: string;
  error?: string;
};
type Form = {
  action: "mkdir" | "newFile" | "rename" | "move" | "copy" | "delete";
  value: string;
  target?: DiskEntry;
};

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Native Files: all file contents and mutations come from the backend's real disk. */
export function FilesApp({
  windowId,
  initialPath = "",
}: {
  windowId: string;
  initialPath?: string;
}) {
  const t = useT();
  const storedPath = useChromeStore((s) => s.states[windowId]?.path ?? initialPath);
  const path = storedPath === ".Trash" ? "Trash" : storedPath;
  const requestedFile = useChromeStore((s) => s.states[windowId]?.file ?? "");
  const apps = useAppStore((state) => state.apps);
  const windows = useWindowStore((state) => state.windows);
  const [handoff, setHandoff] = useState<"pending" | "done" | null>(null);
  const [history, setHistory] = useState({ paths: [path], index: 0 });
  const [navigating, setNavigating] = useState(false);
  const navigationSequence = useRef(0);
  const [entries, setEntries] = useState<DiskEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  const trash = path === "Trash";
  const dirty = !!editor && editor.content !== editor.saved;
  const current = entries.find((e) => e.path === selected);
  const filtered = entries.filter((e) =>
    e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const errorText = (code: string) =>
    code.startsWith("communication.") || code.startsWith("files.error.")
      ? t(code)
      : t(`files.error.${code}`) === `files.error.${code}`
        ? t("files.error.failed")
        : t(`files.error.${code}`);
  const focusInput = useCallback((node: HTMLInputElement | null) => node?.focus(), []);

  useEffect(() => {
    setHistory((value) =>
      value.paths[value.index] === path
        ? value
        : { paths: [...value.paths.slice(0, value.index + 1), path], index: value.index + 1 },
    );
  }, [path]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    requestFiles({ action: "list", path })
      .then((result) => {
        if (!active) return;
        setEntries(result.entries ?? []);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [path, refresh]);
  useEffect(() => {
    const reload = () => setRefresh((n) => n + 1);
    const subscribe = () =>
      void sendCommunication(windowId, {
        action: "subscribe",
        subscription: {
          id: "files-list",
          topic: "files.changed",
          source: { system: true },
          path,
          mode: "data",
        },
      }).catch(() => {});
    const off = wsClient.on("s2c.communication.delivery", ({ delivery }) => {
      if (
        delivery.windowId === windowId &&
        delivery.kind === "event" &&
        delivery.channel === "files-list"
      )
        reload();
    });
    subscribe();
    const reconnect = wsClient.on("s2c.boot.ready", () => {
      reload();
      subscribe();
    });
    return () => {
      off();
      reconnect();
    };
  }, [windowId, path]);

  const canLeave = () => !dirty || window.confirm(t("files.discard"));
  const navigate = async (address: string, historyIndex?: number): Promise<boolean> => {
    if (busy || !canLeave()) return false;
    const id = ++navigationSequence.current;
    setNavigating(true);
    setError(null);
    try {
      const next = resolveDiskAddress(address, path);
      const result = await requestFiles({ action: "stat", path: next });
      if (id !== navigationSequence.current) return false;
      if (result.entry?.kind !== "directory") {
        await requestFiles({ action: "open", path: next });
        return true;
      }
      sequence.current++;
      setEditor(null);
      setSelected(null);
      setForm(null);
      setQuery("");
      if (historyIndex !== undefined) setHistory((value) => ({ ...value, index: historyIndex }));
      if (next !== path) setEntries([]);
      else setRefresh((n) => n + 1);
      useChromeStore.getState().set(windowId, { path: next, file: "" });
      return true;
    } catch (error) {
      if (id === navigationSequence.current) setError((error as Error).message);
      return false;
    } finally {
      if (id === navigationSequence.current) setNavigating(false);
    }
  };
  const openFile = useCallback(async (file: string) => {
    const id = ++sequence.current;
    setError(null);
    setEditor({ path: file, content: "", saved: "" });
    try {
      const result = await requestFiles({ action: "read", path: file });
      if (id === sequence.current)
        setEditor({
          path: file,
          content: result.content ?? "",
          saved: result.content ?? "",
          version: result.version,
        });
    } catch (e) {
      if (id === sequence.current)
        setEditor({ path: file, content: "", saved: "", error: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    if (requestedFile) void openFile(requestedFile);
  }, [requestedFile, openFile]);

  const mutate = async (command: FileRequestCommand) => {
    setBusy(true);
    setError(null);
    try {
      return await requestFiles(command);
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const submitForm = async () => {
    if (!form || busy) return;
    const value = form.value.trim();
    if (form.action !== "delete" && !value) return;
    if (
      ["mkdir", "newFile", "rename"].includes(form.action) &&
      (value.includes("/") || value.includes("\\") || value === "." || value === "..")
    ) {
      setError("path");
      return;
    }
    const target = form.target;
    const command: DiskCommand =
      form.action === "delete"
        ? { action: "delete", path: target!.path }
        : form.action === "mkdir"
          ? { action: "mkdir", path: child(path, value) }
          : form.action === "newFile"
            ? { action: "write", path: child(path, value), content: "" }
            : {
                action: form.action === "copy" ? "copy" : "move",
                path: target!.path,
                destination:
                  form.action === "rename"
                    ? child(
                        parent(target!.path),
                        target!.kind === "shortcut" && !value.toLowerCase().endsWith(".vibelink")
                          ? `${value}.vibelink`
                          : value,
                      )
                    : value.replace(/^\/+/, ""),
              };
    const result = await mutate(command);
    if (result) {
      setForm(null);
      setSelected(null);
      if (form.action === "newFile" && result.path) void openFile(result.path);
    }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.size > FILE_UPLOAD_LIMIT) throw new Error("uploadSize");
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("failed"));
          reader.readAsDataURL(file);
        });
        await requestFiles({
          action: "write",
          path: child(path, file.name),
          content,
          encoding: "base64",
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  };
  const save = async () => {
    if (!editor?.version || busy) return;
    const content = editor.content;
    const result = await mutate({
      action: "write",
      path: editor.path,
      content,
      version: editor.version,
    });
    if (result) setEditor((e) => e && { ...e, saved: content, version: result.version });
  };
  const openEntry = (e: DiskEntry) => {
    if (trash || busy) return;
    if (e.kind === "directory") navigate(e.path);
    else void mutate({ action: "open", path: e.path });
  };
  const sendFile = async (
    target: { appId: string; open: true; newWindow?: boolean } | { windowId: string },
  ) => {
    if (!current) return;
    setHandoff("pending");
    setError(null);
    try {
      await sendCommunication(windowId, {
        action: "request",
        target,
        topic: "file.open",
        data: { path: current.path },
        responseMode: "data",
        channel: "open-with",
      });
      setHandoff("done");
      setRefresh((n) => n + 1);
    } catch (e) {
      setHandoff(null);
      setError((e as Error).message);
    }
  };

  return (
    <div className="vibe-files flex h-full min-w-0 flex-col bg-background text-foreground">
      {handoff && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 text-xs"
        >
          <span className="flex-1">
            {t(handoff === "pending" ? "communication.processing" : "communication.completed")}
          </span>
          {handoff === "done" && (
            <button
              className={button}
              onClick={() => setHandoff(null)}
              aria-label={t("communication.dismiss")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      <FilesAddressBar
        path={path}
        busy={busy || navigating}
        loading={loading || navigating}
        canBack={history.index > 0}
        canForward={history.index < history.paths.length - 1}
        onBack={() => {
          if (history.index > 0)
            void navigate(history.paths[history.index - 1]!, history.index - 1);
        }}
        onForward={() => {
          if (history.index < history.paths.length - 1)
            void navigate(history.paths[history.index + 1]!, history.index + 1);
        }}
        onUp={() => {
          void navigate(parent(path));
        }}
        onNavigate={navigate}
        onRefresh={() => {
          setError(null);
          setRefresh((n) => n + 1);
        }}
        directories={entries
          .filter((entry) => entry.kind === "directory")
          .map((entry) => entry.path)}
      />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("files.locations")}
          className="flex w-36 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-card/30 p-2 text-xs"
        >
          <button
            aria-current={!path ? "page" : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-2 text-left ${!path ? "bg-accent" : "hover:bg-accent/50"}`}
            onClick={() => navigate("")}
          >
            <HardDrive className="size-4 shrink-0" />
            {t("files.disk")}
          </button>
          {SYSTEM_FOLDERS.map((folder) => (
            <button
              key={folder}
              aria-current={path === folder ? "page" : undefined}
              className={`flex items-center gap-2 rounded-md px-2 py-2 text-left ${path === folder ? "bg-accent" : "hover:bg-accent/50"}`}
              onClick={() => navigate(folder)}
            >
              {folder === "Trash" ? (
                <Trash2 className="size-4 shrink-0" />
              ) : (
                <Folder className="size-4 shrink-0" />
              )}
              {folder}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {editor ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
                <button
                  className={button}
                  title={t("files.back")}
                  disabled={busy}
                  onClick={() => {
                    if (canLeave()) {
                      sequence.current++;
                      setEditor(null);
                      setError(null);
                    }
                  }}
                >
                  <ArrowLeft className="size-3.5" />
                </button>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  <File className="mr-1.5 inline size-3.5" />
                  {editor.path.split("/").at(-1)}
                  {dirty ? " *" : ""}
                </span>
                <a
                  className={button}
                  href={fileDownloadUrl(editor.path)}
                  download
                  title={t("files.download")}
                >
                  <Download className="size-3.5" />
                </a>
                {!editor.error && (
                  <button
                    className={button}
                    disabled={!dirty || busy || !editor.version}
                    onClick={() => void save()}
                  >
                    <Save className="size-3.5" />
                    {t("files.save")}
                  </button>
                )}
              </div>
              {error && (
                <p
                  role="alert"
                  className="border-b bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {errorText(error)}
                </p>
              )}
              {editor.error ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  <File className="size-9 opacity-50" />
                  <span>{editor.path.split("/").at(-1)}</span>
                  {errorText(editor.error)}
                  <a className={button} href={fileDownloadUrl(editor.path)} download>
                    <Download className="size-3.5" />
                    {t("files.download")}
                  </a>
                </div>
              ) : editor.version ? (
                <textarea
                  aria-label={t("files.content")}
                  className="min-h-0 w-full flex-1 resize-none bg-background p-4 font-mono text-[13px] leading-relaxed outline-none"
                  spellCheck={false}
                  disabled={busy}
                  value={editor.content}
                  onChange={(e) => setEditor({ ...editor, content: e.target.value })}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                      e.preventDefault();
                      void save();
                    }
                  }}
                />
              ) : (
                <p role="status" className="p-4 text-xs text-muted-foreground">
                  {t("files.loading")}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap gap-1.5 border-b px-3 py-2">
                {trash ? (
                  <>
                    <button
                      className={button}
                      disabled={!current || busy}
                      onClick={async () => {
                        if (current && (await mutate({ action: "restore", path: current.path })))
                          setSelected(null);
                      }}
                    >
                      <ArrowUp className="size-3.5" />
                      {t("files.restore")}
                    </button>
                    <button
                      className={button}
                      disabled={!current || busy}
                      onClick={() => setForm({ action: "delete", value: "", target: current })}
                    >
                      <Trash2 className="size-3.5" />
                      {t("files.delete")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={button}
                      aria-haspopup="menu"
                      disabled={
                        !current || current.kind !== "file" || busy || handoff === "pending"
                      }
                      onClick={(e) =>
                        openContextMenu(e, [
                          ...Object.values(apps)
                            .filter(
                              (a) =>
                                a.isInstalled &&
                                (!a.presetId ||
                                  ["text-viewer", "media-viewer"].includes(a.presetId)),
                            )
                            .map((app) => ({
                              type: "item" as const,
                              label: app.name,
                              icon: (
                                <AppIcon
                                  name={app.icon}
                                  presetId={app.presetId}
                                  label={app.name}
                                  className="size-4"
                                />
                              ),
                              onSelect: () =>
                                void sendFile({
                                  appId: app.id,
                                  open: true,
                                  newWindow: !app.manifest.singleInstance,
                                }),
                            })),
                          { type: "separator" as const },
                          {
                            type: "submenu" as const,
                            label: t("communication.sendWindow"),
                            items: Object.values(windows)
                              .filter(
                                (w) => w.isOpen && w.id !== windowId && !apps[w.appId]?.presetId,
                              )
                              .map((w) => ({
                                type: "item" as const,
                                label: w.title,
                                onSelect: () => void sendFile({ windowId: w.id }),
                              })),
                          },
                        ])
                      }
                    >
                      <Send className="size-3.5" />
                      {t("communication.openWith")}
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => setForm({ action: "mkdir", value: "" })}
                    >
                      <FolderPlus className="size-3.5" />
                      {t("files.mkdir")}
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => setForm({ action: "newFile", value: "" })}
                    >
                      <FilePlus className="size-3.5" />
                      {t("files.newFile")}
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => upload.current?.click()}
                    >
                      <Upload className="size-3.5" />
                      {t("files.upload")}
                    </button>
                    <input
                      ref={upload}
                      type="file"
                      multiple
                      className="hidden"
                      aria-label={t("files.upload")}
                      onChange={(e) => void importFiles(e.target.files)}
                    />
                    {current && (
                      <>
                        <button
                          className={button}
                          title={t("files.rename")}
                          disabled={busy}
                          onClick={() =>
                            setForm({ action: "rename", value: current.name, target: current })
                          }
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          className={button}
                          title={t("files.move")}
                          disabled={busy}
                          onClick={() =>
                            setForm({ action: "move", value: current.path, target: current })
                          }
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          className={button}
                          title={t("files.copy")}
                          disabled={busy}
                          onClick={() =>
                            setForm({ action: "copy", value: current.path, target: current })
                          }
                        >
                          <Copy className="size-3.5" />
                        </button>
                        <button
                          className={button}
                          title={t("files.trashItem")}
                          disabled={busy}
                          onClick={async () => {
                            if (await mutate({ action: "trash", path: current.path }))
                              setSelected(null);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                        {current.kind === "file" && !fileMediaType(current.path) && (
                          <button
                            className={button}
                            title={t("files.edit")}
                            disabled={busy}
                            onClick={() => void openFile(current.path)}
                          >
                            <FilePenLine className="size-3.5" />
                          </button>
                        )}
                        {(current.kind === "file" || current.kind === "shortcut") && (
                          <a
                            className={button}
                            href={fileDownloadUrl(current.path)}
                            download
                            title={t("files.download")}
                          >
                            <Download className="size-3.5" />
                          </a>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
              {form && (
                <form
                  className="space-y-2 border-b bg-card/50 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitForm();
                  }}
                >
                  <label className="block text-xs font-medium" htmlFor={`${windowId}-file-name`}>
                    {t(`files.${form.action}`)}
                    {form.target ? ` · ${form.target.name}` : ""}
                  </label>
                  {form.action === "delete" ? (
                    <p className="text-xs text-muted-foreground">{t("files.deleteConfirm")}</p>
                  ) : (
                    <input
                      id={`${windowId}-file-name`}
                      ref={focusInput}
                      className={`${input} w-full`}
                      value={form.value}
                      disabled={busy}
                      placeholder={t(
                        form.action === "move" || form.action === "copy"
                          ? "files.destination"
                          : "files.name",
                      )}
                      onChange={(e) => setForm({ ...form, value: e.target.value })}
                    />
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className={button}
                      disabled={busy}
                      onClick={() => setForm(null)}
                    >
                      <X className="size-3.5" />
                      {t("files.cancel")}
                    </button>
                    <button className={button} disabled={busy}>
                      <Check className="size-3.5" />
                      {t("files.confirm")}
                    </button>
                  </div>
                </form>
              )}
              {error && (
                <p
                  role="alert"
                  className="border-b bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {errorText(error)}
                </p>
              )}
              <div className="shrink-0 px-3 py-2">
                <input
                  className={`${input} w-full text-xs`}
                  aria-label={t("files.search")}
                  placeholder={t("files.search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div
                role="listbox"
                aria-label={t("files.entries")}
                className="min-h-0 flex-1 overflow-auto px-2 pb-2"
              >
                {loading && !entries.length ? (
                  <p role="status" className="p-4 text-center text-xs text-muted-foreground">
                    {t("files.loading")}
                  </p>
                ) : !filtered.length ? (
                  <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Folder className="size-8 opacity-40" />
                    {t("files.empty")}
                  </div>
                ) : (
                  filtered.map((e) => (
                    <button
                      key={e.path}
                      role="option"
                      aria-selected={selected === e.path}
                      onClick={() => setSelected(e.path)}
                      onDoubleClick={() => openEntry(e)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          openEntry(e);
                        }
                      }}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_68px] items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px] ${selected === e.path ? "bg-accent" : "hover:bg-accent/40"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {e.kind === "shortcut" ? (
                          <span className="relative shrink-0">
                            <AppIcon
                              name={apps[e.targetAppId ?? ""]?.icon ?? e.icon}
                              presetId={apps[e.targetAppId ?? ""]?.presetId}
                              label={e.name}
                              className="size-5"
                            />
                            <CornerUpRight className="absolute -bottom-0.5 -left-1 size-2.5 rounded-sm bg-background" />
                          </span>
                        ) : e.kind === "directory" ? (
                          <Folder className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <File className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{e.name}</span>
                          {e.originalPath && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              /{e.originalPath}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="text-right text-[10px] text-muted-foreground">
                        {e.kind === "directory"
                          ? t("files.folder")
                          : e.kind === "shortcut"
                            ? t("files.shortcut")
                            : e.kind === "symlink"
                              ? t("files.link")
                              : sizeLabel(e.size)}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div
                role="status"
                className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5 text-[10px] text-muted-foreground"
              >
                <span>{busy ? t("files.working") : `${filtered.length} ${t("files.items")}`}</span>
                {current && (
                  <span className="ml-auto">{new Date(current.modifiedAt).toLocaleString()}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
