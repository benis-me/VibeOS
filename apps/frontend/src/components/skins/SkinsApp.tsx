import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal,
  Upload,
  Download,
  Plus,
  Copy,
  Pencil,
  Trash2,
  ArrowUp,
  Square,
  Loader2,
  Palette,
} from "lucide-react";
import { MAX_SKIN_PACKAGE_BYTES, skinRequestRunning, type SkinCommand } from "@vibeos/shared";
import { useSkinStore, sendSkinCommand } from "@/stores/skinStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { openContextMenu } from "@/components/contextmenu/ContextMenu";
import { useT } from "@/lib/i18n";

const button =
  "vibe-btn inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border bg-card px-2 text-xs hover:bg-accent disabled:opacity-40";
const input =
  "vibe-input min-w-0 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function SkinsApp() {
  const t = useT();
  const skins = useSkinStore((s) => s.skins);
  const activeId = useSettingsStore((s) => s.settings?.skin ?? "devdock");
  const [selected, setSelected] = useState(activeId);
  useEffect(() => setSelected(activeId), [activeId]);
  const skin =
    skins.find((s) => s.id === selected) ?? skins.find((s) => s.id === activeId) ?? skins[0];
  const prompt = useSkinStore((s) => s.drafts[skin?.id ?? ""] ?? "");
  const connected = useConnectionStore((s) => s.connected);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [edit, setEdit] = useState<"create" | "duplicate" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState(Date.now());
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = skin?.requests.find((r) => skinRequestRunning(r.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running?.id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [skin?.id, skin?.requests.length, running?.status]);
  if (!skin) return null;
  const draft = (text: string) => useSkinStore.getState().draft(skin.id, text);
  const perform = async (command: SkinCommand) => {
    setPending(true);
    setError("");
    try {
      const id = await sendSkinCommand(command);
      if (id) setSelected(id);
      setEdit(null);
      if (command.action === "generate") useSkinStore.getState().draft(command.id, "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const begin = (action: typeof edit) => {
    setEdit(action);
    setError("");
    setName(
      action === "rename"
        ? skin.name
        : action === "duplicate"
          ? `${skin.name} ${t("skins.copySuffix")}`
          : "",
    );
  };
  const submitEdit = () => {
    if (edit === "delete") void perform({ action: "delete", id: skin.id });
    else if (edit === "rename") void perform({ action: "rename", id: skin.id, name });
    else
      void perform({
        action: "create",
        name,
        ...(edit === "duplicate" ? { sourceId: skin.id } : {}),
      });
  };
  const disabled = pending || !connected;
  return (
    <div className="vibe-skins flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Palette className="size-4 shrink-0 text-muted-foreground" />
          <select
            aria-label={t("skins.select")}
            className={`${input} h-8 flex-1`}
            value={skin.id}
            disabled={disabled}
            onChange={(e) => {
              setSelected(e.target.value as typeof selected);
              setEdit(null);
              void perform({ action: "activate", id: e.target.value });
            }}
          >
            <optgroup label={t("skins.builtin")}>
              {skins
                .filter((s) => s.builtIn)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
            {skins.some((s) => !s.builtIn) && (
              <optgroup label={t("skins.custom")}>
                {skins
                  .filter((s) => !s.builtIn)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
          {!skin.builtIn && (
            <select
              aria-label={t("skins.version")}
              value={skin.activeVersionId ?? ""}
              disabled={disabled || !skin.versions.length}
              className={`${input} h-8 w-24 shrink-0 text-xs`}
              onChange={(e) =>
                void perform({ action: "activate", id: skin.id, versionId: e.target.value })
              }
            >
              {!skin.versions.length && <option value="">{t("skins.initial")}</option>}
              {skin.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number}
                </option>
              ))}
            </select>
          )}
          {(
            [
              ["create", Plus, false],
              ["duplicate", Copy, !!skin.loadError],
              ["rename", Pencil, skin.builtIn],
              ["delete", Trash2, skin.builtIn],
            ] as const
          ).map(([action, Icon, unavailable]) => (
            <button
              key={action}
              type="button"
              className={`${button} w-8 px-0`}
              title={t(`skins.${action}`)}
              aria-label={t(`skins.${action}`)}
              disabled={disabled || unavailable}
              onClick={() => begin(action)}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
          <button
            type="button"
            className={`${button} w-8 px-0`}
            aria-label={t("skins.more")}
            title={t("skins.more")}
            aria-haspopup="menu"
            disabled={disabled}
            onClick={(e) =>
              openContextMenu(e, [
                {
                  type: "item",
                  label: t("skins.import"),
                  icon: <Upload className="size-4" />,
                  onSelect: () => fileInput.current?.click(),
                },
                {
                  type: "item",
                  label: t("skins.export"),
                  icon: <Download className="size-4" />,
                  disabled: !!skin.loadError,
                  onSelect: () => void perform({ action: "export", id: skin.id }),
                },
              ])
            }
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".vibeskin,application/vibeskin+json"
          className="hidden"
          aria-label={t("skins.import")}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            if (file.size > MAX_SKIN_PACKAGE_BYTES) {
              setError("skins.error.packageSize");
              return;
            }
            try {
              await perform({ action: "import", json: await file.text() });
            } catch {
              setError("skins.error.package");
            }
          }}
        />
        {edit && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitEdit();
            }}
          >
            {edit === "delete" ? (
              <p className="w-full text-xs leading-relaxed">{t("skins.deleteConfirm")}</p>
            ) : (
              <>
                <label htmlFor="skin-name" className="text-xs">
                  {t(`skins.${edit}`)}
                </label>
                <input
                  id="skin-name"
                  // biome-ignore lint/a11y/noAutofocus: Opens only after an explicit New, Copy or Rename action.
                  autoFocus
                  maxLength={80}
                  placeholder={t("skins.name")}
                  className={`${input} flex-1`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </>
            )}
            <button
              className={button}
              type="button"
              disabled={pending}
              onClick={() => setEdit(null)}
            >
              {t("files.cancel")}
            </button>
            <button
              className={`${button} ${edit === "delete" ? "text-destructive" : ""}`}
              disabled={disabled || (edit !== "delete" && !name.trim())}
            >
              {t("files.confirm")}
            </button>
          </form>
        )}
      </div>
      <div
        role="log"
        aria-label={t("skins.conversation")}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      >
        {skin.requests.length === 0 && (
          <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 pb-5 text-center">
            <Palette className="size-8 text-muted-foreground/60" strokeWidth={1.2} />
            <p className="text-sm font-medium">
              {t(skin.builtIn ? "skins.builtinTitle" : "skins.emptyTitle")}
            </p>
            {skin.builtIn && (
              <div className="mt-1 flex gap-2">
                <button className={button} disabled={disabled} onClick={() => begin("create")}>
                  <Plus className="size-3.5" />
                  {t("skins.create")}
                </button>
                <button className={button} disabled={disabled} onClick={() => begin("duplicate")}>
                  <Copy className="size-3.5" />
                  {t("skins.duplicate")}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="mx-auto max-w-2xl space-y-6">
          {skin.requests.map((request) => {
            const v = skin.versions.find((v) => v.id === request.versionId);
            const base = skin.versions.find((v) => v.id === request.baseVersionId);
            return (
              <article key={request.id} className="space-y-2.5">
                <div className="ml-8 rounded-xl rounded-br-sm border bg-muted/50 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {request.prompt}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {t("skins.basedOn")} {base ? `v${base.number}` : t("skins.initial")}
                  </p>
                </div>
                <div className="mr-5 flex gap-2.5 text-[13px] leading-relaxed">
                  <Palette className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className={request.status === "failed" ? "text-destructive" : ""}>
                      {request.summary || t(`skins.status.${request.status}`)}
                    </p>
                    {!!request.error && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">
                        {t(request.error)}
                      </p>
                    )}
                    {v && (
                      <button
                        className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:no-underline"
                        disabled={disabled || skin.activeVersionId === v.id}
                        onClick={() =>
                          void perform({ action: "activate", id: skin.id, versionId: v.id })
                        }
                      >
                        v{v.number}
                      </button>
                    )}
                    {["failed", "cancelled", "interrupted"].includes(request.status) && (
                      <button
                        className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
                        disabled={disabled || !!running}
                        onClick={() => draft(request.prompt)}
                      >
                        {t("skins.retry")}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>
      {!skin.builtIn && (
        <form
          className="shrink-0 border-t px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled && !running && prompt.trim())
              void perform({ action: "generate", id: skin.id, prompt });
          }}
        >
          {running && (
            <div
              role="status"
              className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" />
              <span>
                {t(`skins.status.${running.status}`)} ·{" "}
                {Math.max(0, Math.floor((now - running.createdAt) / 1000))}s
                {running.chars > 0
                  ? ` · ${running.chars.toLocaleString()} ${t("skins.chars")}`
                  : ""}
              </span>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-lg border bg-card p-2 focus-within:ring-2 focus-within:ring-ring/40">
            <textarea
              aria-label={t("skins.prompt")}
              placeholder={t("skins.placeholder")}
              rows={2}
              maxLength={16000}
              value={prompt}
              onChange={(e) => draft(e.target.value)}
              disabled={!!skin.loadError || !connected}
              className="min-w-0 flex-1 resize-none bg-transparent px-1 py-0.5 text-[13px] leading-relaxed outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {running ? (
              <button
                type="button"
                className={`${button} w-8 px-0`}
                aria-label={t("skins.stop")}
                title={t("skins.stop")}
                disabled={disabled}
                onClick={() => void perform({ action: "cancel", id: skin.id })}
              >
                <Square className="size-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                className={`${button} w-8 border-transparent bg-brand px-0 text-brand-foreground hover:bg-brand/90`}
                aria-label={t("skins.generate")}
                title={t("skins.generate")}
                disabled={disabled || !prompt.trim() || !!skin.loadError}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            )}
          </div>
        </form>
      )}
      {(error || skin.loadError || !connected) && (
        <div role="alert" className="shrink-0 border-t px-4 py-2 text-xs text-destructive">
          {t(error || (skin.loadError ? "skins.error.content" : "skins.error.offline"))}
        </div>
      )}
    </div>
  );
}
