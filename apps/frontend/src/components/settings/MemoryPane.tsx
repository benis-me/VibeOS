import { useCallback, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useMemoryStore } from "@/stores/memoryStore";
import { requestMemory } from "@/lib/nativeCommands";
import { useT } from "@/lib/i18n";
import type { MemoryCommand } from "@vibeos/shared";
import { Pane, Switch } from "@/components/ui/primitives";
import { buttonVariants } from "@/components/ui/button";

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
  const filtered = entries.filter((e) => e.content.toLowerCase().includes(query.toLowerCase()));
  // Confirming happens beside what it removes: one entry in place, all of them by the toolbar.
  const confirm = (all: boolean) => (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      <span className="mr-auto text-muted-foreground">
        {t(all ? "memory.clearPrompt" : "memory.removePrompt")}
      </span>
      <button
        type="button"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        disabled={busy}
        onClick={() => setRemoving(null)}
      >
        {t("settings.profile.cancel")}
      </button>
      <button
        type="button"
        className={buttonVariants({ variant: "destructive", size: "sm" })}
        disabled={busy}
        onClick={() => void run(all ? { action: "clear" } : { action: "remove", id: removing! })}
      >
        {t(all ? "memory.clearConfirm" : "settings.profile.confirmRemove")}
      </button>
    </div>
  );
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
      <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
        {t(enabled ? "memory.hint" : "memory.off")}
      </p>
      <div className="mb-3 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("memory.search")}
          placeholder={t("memory.search")}
          className="vibe-input h-8 min-w-0 flex-1 rounded-md border bg-card px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <button
          type="button"
          className={buttonVariants()}
          disabled={busy || !!draft}
          onClick={() => setDraft({ content: "" })}
        >
          <Plus className="size-3.5" />
          {t("memory.add")}
        </button>
        <button
          type="button"
          className={buttonVariants()}
          disabled={busy || !entries.length}
          onClick={() => setRemoving("all")}
        >
          {t("memory.clear")}
        </button>
      </div>
      {removing === "all" && (
        <div className="mb-3 rounded-lg border bg-card p-3">{confirm(true)}</div>
      )}
      {draft && (
        <form
          className="vibe-group mb-3 rounded-xl border bg-card p-3.5"
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
            className="vibe-input w-full resize-y rounded-lg border bg-background p-3 text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className={buttonVariants({ variant: "ghost" })}
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("settings.profile.cancel")}
            </button>
            <button className={buttonVariants()} disabled={busy || !draft.content.trim()}>
              {t("settings.profile.save")}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="mb-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {filtered.length > 0 ? (
        <ul className="vibe-group divide-y divide-border overflow-hidden rounded-xl border bg-card">
          {filtered.map((entry) => (
            <li key={entry.id} className="px-3.5 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                    {entry.content}
                  </p>
                  <time className="mt-1.5 block text-2xs text-muted-foreground">
                    {new Date(entry.updatedAt).toLocaleString()}
                  </time>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                  title={t("memory.edit")}
                  aria-label={t("memory.edit")}
                  onClick={() => setDraft({ id: entry.id, content: entry.content })}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                  title={t("memory.remove")}
                  aria-label={t("memory.remove")}
                  onClick={() => setRemoving(entry.id)}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {removing === entry.id && <div className="mt-3 border-t pt-3">{confirm(false)}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed px-5 py-10 text-center text-[13px] text-muted-foreground">
          {t(entries.length ? "memory.noResults" : "memory.empty")}
        </div>
      )}
    </Pane>
  );
}
