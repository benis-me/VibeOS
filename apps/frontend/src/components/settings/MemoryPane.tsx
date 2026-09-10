import { useCallback, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useMemoryStore } from "@/stores/memoryStore";
import { requestMemory } from "@/lib/nativeCommands";
import { useT } from "@/lib/i18n";
import type { MemoryCommand } from "@vibeos/shared";
import { Pane, Switch } from "./primitives";

export function MemoryPane() {
  const t = useT();
  const focusEditor = useCallback(
    (node: HTMLInputElement | HTMLTextAreaElement | null) => node?.focus(),
    [],
  );
  const { enabled, entries } = useMemoryStore();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ id?: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  async function run(command: MemoryCommand) {
    setBusy(true);
    setError("");
    try {
      await requestMemory(command);
      if (command.action === "save") setDraft(null);
      setRemoving(null);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : "error.generic"));
    } finally {
      setBusy(false);
    }
  }
  const button =
    "vibe-btn rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40";
  return (
    <Pane
      title={t("memory.title")}
      action={
        <Switch
          label={t("memory.enabled")}
          checked={enabled}
          onChange={(value) => void run({ action: "toggle", enabled: value })}
        />
      }
    >
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        {t(enabled ? "memory.hint" : "memory.off")}
      </p>
      <div className="mb-3 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("memory.search")}
          placeholder={t("memory.search")}
          className="vibe-input min-w-0 flex-1 rounded-md border bg-card px-3 py-1.5 text-[13px]"
        />
        <button
          className={button}
          disabled={busy || !!draft}
          onClick={() => setDraft({ content: "" })}
        >
          <Plus className="mr-1 inline size-3.5" />
          {t("memory.add")}
        </button>
        <button
          className={button}
          disabled={busy || !entries.length}
          onClick={() => setRemoving("all")}
        >
          {t("memory.clear")}
        </button>
      </div>
      {draft && (
        <form
          className="vibe-group mb-3 rounded-lg border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "save", ...draft });
          }}
        >
          <textarea
            ref={focusEditor}
            aria-label={t("memory.content")}
            maxLength={1500}
            rows={4}
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            className="vibe-input w-full resize-y rounded-md border bg-background p-2 text-[13px]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={button} disabled={busy} onClick={() => setDraft(null)}>
              {t("settings.profile.cancel")}
            </button>
            <button className={button} disabled={busy || !draft.content.trim()}>
              {t("settings.profile.save")}
            </button>
          </div>
        </form>
      )}
      {removing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
          <span className="mr-auto">
            {t(removing === "all" ? "memory.clearPrompt" : "settings.profile.removePrompt")}
          </span>
          <button className={button} disabled={busy} onClick={() => setRemoving(null)}>
            {t("settings.profile.cancel")}
          </button>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(
                removing === "all" ? { action: "clear" } : { action: "remove", id: removing },
              )
            }
          >
            {t("settings.profile.confirmRemove")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <ul className="vibe-group divide-y rounded-lg border bg-card">
        {entries
          .filter((e) => e.content.toLowerCase().includes(query.toLowerCase()))
          .map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                  {entry.content}
                </p>
                <time className="mt-1 block text-[11px] text-muted-foreground">
                  {new Date(entry.updatedAt).toLocaleString()}
                </time>
              </div>
              <button
                disabled={busy}
                className="rounded p-1.5 hover:bg-accent"
                title={t("memory.edit")}
                aria-label={t("memory.edit")}
                onClick={() => setDraft({ id: entry.id, content: entry.content })}
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                disabled={busy}
                className="rounded p-1.5 hover:bg-accent"
                title={t("memory.remove")}
                aria-label={t("memory.remove")}
                onClick={() => setRemoving(entry.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
      </ul>
      {!entries.length && (
        <p className="py-8 text-center text-[13px] text-muted-foreground">{t("memory.empty")}</p>
      )}
    </Pane>
  );
}
