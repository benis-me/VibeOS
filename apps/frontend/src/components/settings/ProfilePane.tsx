import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { ProfileChange } from "@vibeos/shared";
import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { Pane, Switch } from "./primitives";

type Draft = { id?: string; content: string };

export function ProfilePane() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const entries = settings?.profileEntries ?? [];
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<(Draft & { previousIds: string[] }) | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const focusEditor = useCallback((node: HTMLTextAreaElement | null) => node?.focus(), []);
  const change = (payload: ProfileChange) => wsClient.send("c2s.profile.update", payload);
  const enabledCount = entries.filter((e) => e.enabled).length;
  const filtered = entries.filter((e) =>
    e.content.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // Keep the draft until the backend confirms the saved content; errors leave it editable.
  useEffect(() => {
    if (!pending) return;
    const saved = entries.some(
      (e) =>
        e.content === pending.content &&
        (pending.id ? e.id === pending.id : !pending.previousIds.includes(e.id)),
    );
    if (saved) {
      setDraft(null);
      setPending(null);
      setQuery("");
    }
  }, [entries, pending]);
  useEffect(() => wsClient.on("s2c.error", () => setPending(null)), []);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 60000);
    return () => clearTimeout(timer);
  }, [pending]);

  const save = () => {
    const content = draft?.content.trim();
    if (!draft || !content || pending) return;
    setPending({ ...draft, content, previousIds: entries.map((e) => e.id) });
    change({ action: "save", id: draft.id, content });
  };
  return (
    <Pane
      title={t("settings.cat.profile")}
      action={
        <button
          disabled={!!draft}
          onClick={() => {
            setDraft({ content: "" });
            setRemoving(null);
          }}
          className="vibe-btn flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[12px] transition-colors hover:bg-accent disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          {t("settings.profile.add")}
        </button>
      }
    >
      <p className="mb-5 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
        {t("settings.profile.hint")}
      </p>

      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="vibe-group mb-4 space-y-3 rounded-xl border bg-card p-3.5"
        >
          <label className="block text-[13px] font-medium">
            {t(draft.id ? "settings.profile.edit" : "settings.profile.add")}
            <textarea
              ref={focusEditor}
              value={draft.content}
              disabled={!!pending}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder={t("settings.profile.placeholder")}
              rows={5}
              className="vibe-input mt-2 w-full resize-y rounded-lg border bg-background p-3 text-[13px] font-normal leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={!!pending}
              onClick={() => setDraft(null)}
              className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-accent disabled:opacity-40"
            >
              {t("settings.profile.cancel")}
            </button>
            <button
              type="submit"
              disabled={!draft.content.trim() || !!pending}
              className="vibe-btn rounded-lg border bg-background px-3 py-1.5 text-[12px] hover:bg-accent disabled:opacity-40"
            >
              {t(pending ? "settings.profile.saving" : "settings.profile.save")}
            </button>
          </div>
        </form>
      )}

      <div className="mb-3 flex items-center justify-between gap-3 text-[12px]">
        <span className="text-muted-foreground" aria-live="polite">
          {enabledCount
            ? `${t("settings.profile.enabled")} · ${enabledCount} / ${entries.length}`
            : t("settings.profile.off")}
        </span>
        <button
          disabled={!enabledCount}
          onClick={() => change({ action: "disable-all" })}
          className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          {t("settings.profile.disableAll")}
        </button>
      </div>
      {entries.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("settings.profile.search")}
          placeholder={t("settings.profile.search")}
          className="vibe-input mb-3 w-full rounded-lg border bg-card px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      )}
      {filtered.length > 0 ? (
        <ul className="vibe-group divide-y divide-border overflow-hidden rounded-xl border bg-card">
          {filtered.map((entry) => (
            <li key={entry.id} className="px-3.5 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p
                    className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${entry.enabled ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {entry.content}
                  </p>
                  <span className="mt-1.5 block text-[11px] text-muted-foreground">
                    {t(entry.enabled ? "settings.profile.enabled" : "settings.profile.disabled")}
                  </span>
                </div>
                <Switch
                  checked={entry.enabled}
                  label={`${t("settings.profile.enableEntry")}: ${entry.content}`}
                  onChange={(enabled) => change({ action: "toggle", id: entry.id, enabled })}
                />
                <button
                  disabled={!!draft}
                  aria-label={t("settings.profile.edit")}
                  title={t("settings.profile.edit")}
                  onClick={() => {
                    setDraft({ id: entry.id, content: entry.content });
                    setRemoving(null);
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  disabled={!!draft}
                  aria-label={t("settings.profile.remove")}
                  title={t("settings.profile.remove")}
                  onClick={() => setRemoving(entry.id)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              {removing === entry.id && (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3 text-[12px]">
                  <span className="mr-auto text-muted-foreground">
                    {t("settings.profile.removePrompt")}
                  </span>
                  <button
                    onClick={() => setRemoving(null)}
                    className="rounded-md px-2 py-1 hover:bg-accent"
                  >
                    {t("settings.profile.cancel")}
                  </button>
                  <button
                    onClick={() => {
                      change({ action: "remove", id: entry.id });
                      setRemoving(null);
                    }}
                    className="rounded-md px-2 py-1 text-destructive hover:bg-destructive/10"
                  >
                    {t("settings.profile.confirmRemove")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed px-5 py-10 text-center text-[13px] text-muted-foreground">
          {t(entries.length ? "settings.profile.noResults" : "settings.profile.empty")}
        </div>
      )}
    </Pane>
  );
}
