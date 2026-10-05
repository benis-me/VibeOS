import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Copy,
  Download,
  Eraser,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import type { ApplicationCommand, AppRuntime } from "@vibeos/shared";
import { useAppStore } from "@/stores/appStore";
import { useApplicationStore } from "@/stores/applicationStore";
import { useWindowStore } from "@/stores/windowStore";
import { requestApplication } from "@/lib/nativeCommands";
import { requestFiles } from "@/lib/files";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { isComposing } from "@/lib/fields";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { AppIcon } from "@/components/AppIcon";
import { cn } from "@/lib/utils";

export function AppStoreApp() {
  const t = useT();
  const focusEditor = useCallback(
    (node: HTMLInputElement | HTMLTextAreaElement | null) => node?.focus(),
    [],
  );
  const appMap = useAppStore((s) => s.apps);
  const state = useApplicationStore();
  const windows = useWindowStore((s) => s.windows);
  const apps = Object.values(appMap).filter(
    (a) => a.kind === "virtual" && a.isInstalled && a.id !== "__transient__",
  );
  const app = apps.find((a) => a.id === state.selectedId) ?? apps[0];
  const detail = state.applications.find((a) => a.appId === app?.id);
  const [prompt, setPrompt] = useState("");
  const [runtime, setRuntime] = useState<AppRuntime>("html");
  const activeVersion = detail?.versions.find((v) => v.id === detail.activeVersionId);
  useEffect(() => {
    setRuntime(activeVersion?.number === 0 ? "interactive" : (activeVersion?.runtime ?? "html"));
  }, [app?.id, activeVersion?.id, activeVersion?.runtime]);
  const [draft, setDraft] = useState<{
    action: "create" | "rename";
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"uninstall" | "clear-data" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const running = detail?.requests.find(
    (r) => r.status === "generating" || r.status === "validating",
  );
  const button = buttonVariants();
  const iconButton = buttonVariants({ size: "icon" });
  useEffect(() => {
    setPrompt("");
    setError("");
    setNotice("");
    setConfirm(null);
  }, [app?.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [detail?.requests]);
  async function run(command: ApplicationCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await requestApplication(command);
      if (result.appId && ["create", "duplicate", "import"].includes(command.action))
        state.select(result.appId);
      if (command.action === "generate") setPrompt("");
      if (command.action === "export")
        setNotice(`${t("applications.exported")} ${result.path ?? "Desktop"}`);
      setDraft(null);
      setConfirm(null);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "error.generic"));
    } finally {
      setBusy(false);
    }
  }
  const versionLabel = (appId: string) => {
    const d = state.applications.find((x) => x.appId === appId);
    const v = d?.versions.find((x) => x.id === d.activeVersionId);
    return !v ? "" : v.number === 0 ? t("applications.draft") : `v${v.number}`;
  };
  const appMenu = (e: React.MouseEvent) =>
    app &&
    openContextMenu(e, [
      {
        type: "item",
        label: t("skins.rename"),
        icon: <Pencil className="size-4" />,
        disabled: !!running,
        onSelect: () => setDraft({ action: "rename", name: app.name }),
      },
      {
        type: "item",
        label: t("applications.duplicate"),
        icon: <Copy className="size-4" />,
        onSelect: () =>
          void run({
            action: "duplicate",
            appId: app.id,
            name: `${app.name} ${t("skins.copySuffix")}`,
          }),
      },
      {
        type: "item",
        label: t("applications.contents"),
        icon: <FolderOpen className="size-4" />,
        disabled: !detail,
        onSelect: () =>
          detail &&
          void requestFiles({ action: "reveal", path: detail.path }).catch((e) =>
            setError(t(e.message)),
          ),
      },
      { type: "separator" },
      {
        type: "item",
        label: t("store.export"),
        icon: <Download className="size-4" />,
        onSelect: () => void run({ action: "export", appId: app.id }),
      },
      {
        type: "item",
        label: t("applications.exportWithData"),
        icon: <Download className="size-4" />,
        onSelect: () => void run({ action: "export", appId: app.id, includeData: true }),
      },
      { type: "separator" },
      {
        type: "item",
        label: t("applications.clearData"),
        icon: <Eraser className="size-4" />,
        danger: true,
        onSelect: () => setConfirm("clear-data"),
      },
      {
        type: "item",
        label: t("applications.uninstall"),
        icon: <Trash2 className="size-4" />,
        danger: true,
        onSelect: () => setConfirm("uninstall"),
      },
    ]);
  const ghostIcon = buttonVariants({ variant: "ghost", size: "icon" });

  // Applications sit in a list beside the selected one's history, like a store's
  // sidebar; a narrow window keeps only their icons.
  return (
    <div className="@container flex h-full min-h-0 bg-background text-foreground">
      <aside className="flex w-52 shrink-0 flex-col border-r bg-muted/30 @max-xl:w-14">
        <div className="flex h-12 shrink-0 items-center gap-0.5 px-2 @max-xl:justify-center">
          <span className="min-w-0 flex-1 truncate px-1.5 text-xs font-medium text-muted-foreground @max-xl:sr-only">
            {t("applications.list")}
          </span>
          <button
            type="button"
            className={ghostIcon}
            title={t("applications.create")}
            aria-label={t("applications.create")}
            disabled={busy}
            onClick={() => setDraft({ action: "create", name: "" })}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            className={`${ghostIcon} @max-xl:hidden`}
            title={t("store.import")}
            aria-label={t("store.import")}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-4" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".vibeapp,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                if (f.size > 24 * 1024 * 1024) setError(t("applications.error.package"));
                else void f.text().then((json) => run({ action: "import", json }));
              }
            }}
          />
        </div>
        <nav
          aria-label={t("applications.list")}
          className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2"
        >
          {apps.map((a) => {
            const active = a.id === app?.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-current={active ? "page" : undefined}
                title={a.name}
                onClick={() => state.select(a.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors @max-xl:justify-center @max-xl:px-0",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/80 hover:bg-accent/50",
                )}
              >
                <AppIcon name={a.icon} label={a.name} className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate @max-xl:sr-only">{a.name}</span>
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground @max-xl:hidden">
                  {versionLabel(a.id)}
                </span>
              </button>
            );
          })}
          {!apps.length && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground @max-xl:hidden">
              {t("store.empty")}
            </p>
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 space-y-2 border-b p-3 empty:hidden">
          {app && (
            <div className="flex items-center gap-2">
              <AppIcon name={app.icon} label={app.name} className="size-6 shrink-0" />
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={app.name}>
                {app.name}
              </h2>
              <Select
                aria-label={t("skins.version")}
                disabled={!detail || busy || !!running}
                value={detail?.activeVersionId ?? ""}
                onChange={(versionId) => void run({ action: "activate", appId: app.id, versionId })}
                className="max-w-40 shrink-0"
              >
                {!detail && <option value="">—</option>}
                {detail?.versions.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.number === 0 ? t("applications.draft") : `v${v.number}`} ·{" "}
                    {t(`runtime.${v.runtime}`)}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className={button}
                onClick={() => wsClient.send("c2s.window.open", { appId: app.id })}
              >
                {t("applications.open")}
              </button>
              <button
                type="button"
                className={iconButton}
                title={t("applications.more")}
                aria-label={t("applications.more")}
                aria-haspopup="menu"
                disabled={busy}
                onClick={appMenu}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </div>
          )}
          {draft && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  draft.action === "create"
                    ? { action: "create", name: draft.name }
                    : { action: "rename", appId: app!.id, name: draft.name },
                );
              }}
            >
              <input
                ref={focusEditor}
                aria-label={t(
                  draft.action === "create" ? "applications.create" : "applications.name",
                )}
                placeholder={t("applications.name")}
                value={draft.name}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="vibe-input h-8 min-w-0 flex-1 rounded-md border bg-card px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <button
                type="button"
                className={buttonVariants({ variant: "ghost" })}
                onClick={() => setDraft(null)}
              >
                {t("settings.profile.cancel")}
              </button>
              <button
                className={buttonVariants({ variant: "default" })}
                disabled={busy || !draft.name.trim()}
              >
                {t(draft.action === "create" ? "files.create" : "skins.rename")}
              </button>
            </form>
          )}
          {confirm && app && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="mr-auto text-muted-foreground">
                {t(
                  confirm === "uninstall"
                    ? "applications.uninstallPrompt"
                    : "applications.clearPrompt",
                )}
              </span>
              <button
                type="button"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                onClick={() => setConfirm(null)}
              >
                {t("settings.profile.cancel")}
              </button>
              <button
                type="button"
                className={buttonVariants({ variant: "destructive", size: "sm" })}
                disabled={busy}
                onClick={() => void run({ action: confirm, appId: app.id })}
              >
                {t(confirm === "uninstall" ? "files.trashItem" : "applications.clearData")}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!app && (
            <div className="mx-auto my-12 flex max-w-sm flex-col items-center gap-4 text-center">
              <p className="text-balance text-[13px] leading-relaxed text-muted-foreground">
                {t("applications.empty")}
              </p>
              <button
                type="button"
                className={buttonVariants({ variant: "default" })}
                onClick={() => setDraft({ action: "create", name: "" })}
              >
                <Plus className="size-3.5" />
                {t("applications.create")}
              </button>
            </div>
          )}
          {/* With no requests yet, show what the application is. */}
          {app && !detail?.requests.length && (
            <div className="mx-auto my-12 flex max-w-sm flex-col items-center gap-1.5 text-center">
              <AppIcon name={app.icon} label={app.name} className="mb-2 size-12" />
              <p className="text-[15px] font-semibold">{app.name}</p>
              {app.manifest.description && (
                <p className="text-balance text-[13px] leading-relaxed text-muted-foreground">
                  {app.manifest.description}
                </p>
              )}
              {activeVersion && (
                <p className="text-2xs text-muted-foreground">
                  {versionLabel(app.id)} · {t(`runtime.${activeVersion.runtime}`)}
                </p>
              )}
            </div>
          )}
          {detail?.requests
            .slice()
            .reverse()
            .map((r) => (
              <div
                key={r.id}
                className="mx-auto mb-5 max-w-2xl space-y-2 text-[13px] leading-relaxed"
              >
                <p className="ml-10 whitespace-pre-wrap rounded-xl bg-accent px-3 py-2 text-accent-foreground">
                  {r.prompt}
                </p>
                <div className="mr-8 px-1">
                  <p className="whitespace-pre-wrap">
                    {r.summary || t(`applications.status.${r.status}`)}
                  </p>
                  {r.error && <p className="text-destructive">{t(r.error)}</p>}
                  {["generating", "validating"].includes(r.status) && (
                    <div
                      role="progressbar"
                      aria-label={t(`applications.status.${r.status}`)}
                      className="mt-2 h-0.5 w-full overflow-hidden bg-foreground/10"
                    >
                      <div className="vibeos-progress h-full w-2/5 bg-brand" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          <div ref={end} />
        </div>
        {app && (
          <form
            className="shrink-0 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim())
                void run({
                  action: "generate",
                  appId: app.id,
                  prompt,
                  runtime,
                  sourceWindowId:
                    state.sourceWindowId && windows[state.sourceWindowId]?.appId === app.id
                      ? state.sourceWindowId
                      : undefined,
                });
            }}
          >
            {Object.values(windows)
              .filter((w) => w.appId === app.id && w.appVersionId !== detail?.activeVersionId)
              .map((w) => (
                <div
                  key={w.id}
                  className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {w.title} · {t("applications.previousWindow")}
                  </span>
                  <button
                    type="button"
                    className={button}
                    disabled={busy || !!running}
                    onClick={() => void run({ action: "update-window", windowId: w.id })}
                  >
                    {t("applications.updateWindow")}
                  </button>
                </div>
              ))}
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              {t("runtime.nextVersion")}
              <Select
                aria-label={t("runtime.nextVersion")}
                value={runtime}
                disabled={busy || !!running}
                onChange={(value) => setRuntime(value as AppRuntime)}
                className="text-foreground"
              >
                <option value="html">{t("runtime.html")}</option>
                <option value="interactive">{t("runtime.interactive")}</option>
              </Select>
            </div>
            <div className="flex items-end gap-2 rounded-lg border bg-card p-2 focus-within:ring-2 focus-within:ring-ring/40">
              <textarea
                aria-label={t("applications.prompt")}
                placeholder={t("applications.prompt")}
                value={prompt}
                maxLength={16000}
                rows={2}
                disabled={!!running}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !isComposing(e.nativeEvent)
                  ) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                className="min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-0.5 text-[13px] leading-relaxed outline-none"
              />
              {running ? (
                <button
                  type="button"
                  className={iconButton}
                  title={t("skins.stop")}
                  aria-label={t("skins.stop")}
                  onClick={() => void run({ action: "cancel", requestId: running.id })}
                >
                  <Square className="size-3.5" />
                </button>
              ) : (
                <button
                  className={buttonVariants({ variant: "default", size: "icon" })}
                  disabled={busy || !prompt.trim()}
                  title={t("applications.generate")}
                  aria-label={t("applications.generate")}
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
