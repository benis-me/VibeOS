import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { WindowState } from "@vibeos/shared";
import { buttonVariants } from "@/components/ui/button";
import { isComposing } from "@/lib/fields";
import { requestApplication } from "@/lib/nativeCommands";
import { useT } from "@/lib/i18n";
import { useApplicationStore } from "@/stores/applicationStore";

/**
 * Change the app from inside its window: the request becomes a new version, which
 * opens in this window's place on success. A temporary experience is saved first.
 */
export function AppEditBar({ win, onClose }: { win: WindowState; onClose: () => void }) {
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const latest = useApplicationStore((s) =>
    s.applications
      .find((a) => a.appId === win.appId)
      ?.requests.find((r) => r.sourceWindowId === win.id),
  );
  const running = latest?.status === "generating" || latest?.status === "validating";
  const failed = sent && (latest?.status === "failed" || latest?.status === "interrupted");
  // The new version has opened in this window's place.
  useEffect(() => {
    if (sent && latest?.status === "succeeded") onClose();
  }, [sent, latest?.status, onClose]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || running) return;
    setError("");
    requestApplication({ action: "generate", appId: win.appId, prompt, sourceWindowId: win.id })
      .then(() => {
        setPrompt("");
        setSent(true);
      })
      .catch((e: Error) => setError(e.message));
  };
  const message = error || (failed ? (latest?.error ?? "applications.status.failed") : "");
  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => e.key === "Escape" && !isComposing(e.nativeEvent) && onClose()}
      className="vibe-appedit absolute inset-x-0 top-0 z-30 flex flex-col gap-1.5 border-b bg-background px-3 py-2 text-xs shadow-sm"
    >
      <div className="flex items-center gap-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: the bar opens from an explicit click to type a change.
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={running}
          placeholder={t("win.editPlaceholder")}
          aria-label={t("win.editApp")}
          className="h-8 min-w-0 flex-1 rounded-md border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <button
          type="submit"
          disabled={!prompt.trim() || running}
          className={buttonVariants({ variant: "default" })}
        >
          {running && <Loader2 className="size-3.5 motion-safe:animate-spin" />}
          {t(running ? `applications.status.${latest.status}` : "win.editSubmit")}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("communication.dismiss")}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {message ? (
        <p role="alert" className="text-destructive">
          {t(message) === message ? t("applications.status.failed") : t(message)}
        </p>
      ) : (
        <p className="text-muted-foreground">{t("win.editHint")}</p>
      )}
    </form>
  );
}
