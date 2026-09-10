import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Send, Square } from "lucide-react";
import type { ApplicationCommand } from "@vibeos/shared";
import { useAppStore } from "@/stores/appStore";
import { useApplicationStore } from "@/stores/applicationStore";
import { useWindowStore } from "@/stores/windowStore";
import { requestApplication } from "@/lib/nativeCommands";
import { requestFiles } from "@/lib/files";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";

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
  const [draft, setDraft] = useState<{ action: "create" | "rename"; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"uninstall" | "clear-data" | null>(null);
  const [includeData, setIncludeData] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const running = detail?.requests.find(
    (r) => r.status === "generating" || r.status === "validating",
  );
  const button =
    "vibe-btn rounded-md border bg-card px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-40";
  useEffect(() => {
    setPrompt("");
    setError("");
    setNotice("");
    setIncludeData(false);
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
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex gap-2">
          <select
            aria-label={t("applications.select")}
            value={app?.id ?? ""}
            onChange={(e) => state.select(e.target.value)}
            className="vibe-input min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-[13px]"
          >
            {!app && <option value="">{t("applications.empty")}</option>}
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("skins.version")}
            disabled={!detail || busy || !!running}
            value={detail?.activeVersionId ?? ""}
            onChange={(e) =>
              app && void run({ action: "activate", appId: app.id, versionId: e.target.value })
            }
            className="vibe-input max-w-44 rounded-md border bg-card px-2 text-xs"
          >
            {!detail && <option value="">—</option>}
            {detail?.versions.map((v) => (
              <option value={v.id} key={v.id}>
                {v.number === 0 ? t("applications.draft") : `v${v.number}`} ·{" "}
                {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          <button
            className={button}
            disabled={busy}
            onClick={() => setDraft({ action: "create", name: "" })}
          >
            <Plus className="mr-1 inline size-3.5" />
            {t("applications.create")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {app && (
            <>
              <button
                className={button}
                onClick={() => wsClient.send("c2s.window.open", { appId: app.id })}
              >
                {t("applications.open")}
              </button>
              <button
                className={button}
                disabled={busy || !!running}
                onClick={() => setDraft({ action: "rename", name: app.name })}
              >
                {t("skins.rename")}
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run({
                    action: "duplicate",
                    appId: app.id,
                    name: `${app.name} ${t("skins.copySuffix")}`,
                  })
                }
              >
                {t("applications.duplicate")}
              </button>
              <button className={button} disabled={busy} onClick={() => setConfirm("uninstall")}>
                {t("applications.uninstall")}
              </button>
              <button className={button} disabled={busy} onClick={() => setConfirm("clear-data")}>
                {t("applications.clearData")}
              </button>
              <button
                className={button}
                disabled={!detail}
                onClick={() =>
                  detail &&
                  void requestFiles({ action: "reveal", path: detail.path }).catch((e) =>
                    setError(t(e.message)),
                  )
                }
              >
                {t("applications.contents")}
              </button>
            </>
          )}
          <button className={button} disabled={busy} onClick={() => fileInput.current?.click()}>
            {t("store.import")}
          </button>
          {app && (
            <>
              <button
                className={button}
                disabled={busy}
                onClick={() => void run({ action: "export", appId: app.id, includeData })}
              >
                {t("store.export")}
              </button>
              <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeData}
                  onChange={(e) => setIncludeData(e.target.checked)}
                />
                {t("applications.includeData")}
              </label>
            </>
          )}
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
              aria-label={t("applications.name")}
              placeholder={t("applications.name")}
              value={draft.name}
              maxLength={100}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="vibe-input min-w-0 flex-1 rounded-md border bg-card px-2 text-[13px]"
            />
            <button className={button} disabled={busy || !draft.name.trim()}>
              {t("settings.profile.save")}
            </button>
            <button type="button" className={button} onClick={() => setDraft(null)}>
              {t("settings.profile.cancel")}
            </button>
          </form>
        )}
        {confirm && app && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="mr-auto">
              {t(
                confirm === "uninstall"
                  ? "applications.uninstallPrompt"
                  : "applications.clearPrompt",
              )}
            </span>
            <button
              className={button}
              disabled={busy}
              onClick={() => void run({ action: confirm, appId: app.id })}
            >
              {t("settings.profile.confirmRemove")}
            </button>
            <button className={button} onClick={() => setConfirm(null)}>
              {t("settings.profile.cancel")}
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
        {!detail?.requests.length && (
          <p className="mx-auto my-12 max-w-sm text-center text-[13px] leading-relaxed text-muted-foreground">
            {t(app ? "applications.promptHint" : "applications.empty")}
          </p>
        )}
        {detail?.requests
          .slice()
          .reverse()
          .map((r) => (
            <div
              key={r.id}
              className="mx-auto mb-5 max-w-2xl space-y-2 text-[13px] leading-relaxed"
            >
              <p className="ml-10 whitespace-pre-wrap rounded-xl bg-accent px-3 py-2">{r.prompt}</p>
              <div className="mr-8 px-1">
                <p className="whitespace-pre-wrap">
                  {r.summary || t(`applications.status.${r.status}`)}
                </p>
                {r.error && <p className="text-destructive">{t(r.error)}</p>}
                {["generating", "validating"].includes(r.status) && (
                  <progress
                    aria-label={t(`applications.status.${r.status}`)}
                    className="mt-2 h-1 w-full"
                  />
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
          <div className="flex items-end gap-2">
            <textarea
              aria-label={t("applications.prompt")}
              placeholder={t("applications.prompt")}
              value={prompt}
              maxLength={16000}
              rows={2}
              disabled={!!running}
              onChange={(e) => setPrompt(e.target.value)}
              className="vibe-input min-h-16 min-w-0 flex-1 resize-y rounded-lg border bg-card p-2.5 text-[13px]"
            />
            {running ? (
              <button
                type="button"
                className={button}
                title={t("skins.stop")}
                aria-label={t("skins.stop")}
                onClick={() => void run({ action: "cancel", requestId: running.id })}
              >
                <Square className="size-4" />
              </button>
            ) : (
              <button
                className={button}
                disabled={busy || !prompt.trim()}
                title={t("applications.generate")}
                aria-label={t("applications.generate")}
              >
                <Send className="size-4" />
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
