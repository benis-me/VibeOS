import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Loader2, Square, Search, X, FolderOpen } from "lucide-react";
import type { AgentRun, ActivityDetails, ActivityFilter } from "@vibeos/shared";
import { useActivityStore } from "@/stores/activityStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requestFiles } from "@/lib/files";

type T = (k: string) => string;

const DOT: Record<string, string> = {
  running: "bg-brand animate-pulse",
  ok: "bg-run",
  error: "bg-destructive",
  aborted: "bg-warn",
};

const COLS =
  "grid grid-cols-[minmax(90px,1.2fr)_minmax(120px,1.8fr)_minmax(72px,0.9fr)_60px_48px_52px_60px_50px] gap-2";

const tok = (r: AgentRun) => (r.inputTokens ?? 0) + (r.outputTokens ?? 0);

export function ActivityMonitorApp() {
  const t = useT();
  const runs = useActivityStore((s) => s.runs);
  const hasMore = useActivityStore((s) => s.hasMore);
  const loading = useActivityStore((s) => s.loading);
  const fetchMore = useActivityStore((s) => s.fetchMore);
  const filter = useActivityStore((s) => s.filter);
  const error = useActivityStore((s) => s.error);
  const setFilter = useActivityStore((s) => s.setFilter);
  const [query, setQuery] = useState(filter.query ?? "");
  const [selected, setSelected] = useState<AgentRun | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (query === (filter.query ?? "")) return;
    const timer = setTimeout(() => setFilter({ ...filter, query: query || undefined }), 200);
    return () => clearTimeout(timer);
  }, [query, filter, setFilter]);

  const summary = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let running = 0;
    let errors = 0;
    let durSum = 0;
    let durN = 0;
    for (const r of runs) {
      tokens += tok(r);
      cost += r.costUsd ?? 0;
      if (r.status === "running") running++;
      if (r.status === "error") errors++;
      if (r.endedAt) {
        durSum += r.endedAt - r.startedAt;
        durN++;
      }
    }
    return {
      count: runs.length,
      tokens,
      cost,
      running,
      errRate: runs.length ? errors / runs.length : 0,
      avgMs: durN ? durSum / durN : 0,
    };
  }, [runs]);

  // Recent runs oldest→newest for the timeline chart.
  const chart = useMemo(() => runs.slice(0, 64).reverse(), [runs]);
  const maxTok = useMemo(() => Math.max(1, ...chart.map(tok)), [chart]);

  const byModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) m.set(r.model ?? "—", (m.get(r.model ?? "—") ?? 0) + tok(r));
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = Math.max(1, ...top.map((x) => x[1]));
    return { top, max };
  }, [runs]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 280) fetchMore();
  };

  return (
    <div className="vibe-activity relative isolate flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div ref={content} className="flex min-h-0 flex-1 flex-col overflow-auto">
        {/* ---- dashboard ---- */}
        <div className="shrink-0 border-b">
          <div className="flex items-center justify-between px-5 pt-4">
            <h1 className="text-[13px] font-semibold tracking-tight">{t("activity.recent")}</h1>
            {summary.running > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] text-brand">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                {summary.running} {t("activity.running")}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-7 gap-y-2 px-5 py-3">
            <Metric label={t("activity.runs")} value={String(summary.count)} />
            <Metric label={t("activity.tokens")} value={fmtTokens(summary.tokens)} />
            <Metric label={t("activity.cost")} value={fmtCost(summary.cost)} />
            <Metric
              label={t("activity.avgLatency")}
              value={summary.avgMs ? `${(summary.avgMs / 1000).toFixed(1)}s` : "—"}
            />
            <Metric
              label={t("activity.errRate")}
              value={`${(summary.errRate * 100).toFixed(0)}%`}
              warn={summary.errRate > 0.2}
            />
          </div>

          <div className="grid grid-cols-[1.7fr_1fr] gap-5 px-5 pb-4">
            <Panel
              title={t("activity.tokenUsage")}
              aside={
                <span className="flex items-center gap-2.5 text-[10px] text-muted-foreground">
                  <Legend className="bg-brand/40" label={t("activity.in")} />
                  <Legend className="bg-brand" label={t("activity.out")} />
                </span>
              }
            >
              <div className="flex h-[72px] items-end gap-px">
                {chart.map((r) => {
                  const total = tok(r);
                  const h = (total / maxTok) * 100;
                  const outShare = total ? ((r.outputTokens ?? 0) / total) * 100 : 0;
                  return (
                    <div
                      key={r.id}
                      className="group relative flex h-full flex-1 flex-col justify-end"
                      style={{ minWidth: 2 }}
                      title={`${r.appName ?? t(`activity.role.${r.role}`)} · ${r.model ?? "—"}\n${fmtTokens(total)} tok · ${fmtCost(r.costUsd ?? 0)}`}
                    >
                      <div
                        className={cn(
                          "w-full rounded-[2px] bg-brand/35 transition-colors group-hover:bg-brand/60",
                          total === 0 && "bg-border",
                        )}
                        style={{ height: `${Math.max(total === 0 ? 6 : 3, h)}%` }}
                      >
                        <div
                          className="w-full rounded-t-[2px] bg-brand"
                          style={{ height: `${outShare}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title={t("activity.byModel")}>
              <div className="flex flex-col gap-1.5 pt-0.5">
                {byModel.top.map(([model, n]) => (
                  <div key={model} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 shrink-0 truncate text-muted-foreground" title={model}>
                      {model}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-brand"
                        style={{ width: `${(n / byModel.max) * 100}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                      {fmtTokens(n)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <div className="vibe-activity-filters flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2">
          <label className="flex min-w-36 flex-1 items-center gap-2 rounded-md border bg-input-background px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-3.5 shrink-0" />
            <input
              type="search"
              aria-label={t("activity.search")}
              placeholder={t("activity.search")}
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label={t("activity.col.status")}
            value={filter.status ?? ""}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            onChange={(e) =>
              setFilter({
                ...filter,
                status: (e.target.value as ActivityFilter["status"]) || undefined,
              })
            }
          >
            <option value="">{t("activity.allStatuses")}</option>
            {["running", "ok", "error", "aborted"].map((status) => (
              <option key={status} value={status}>
                {t(`activity.status.${status}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("activity.role")}
            value={filter.role ?? ""}
            className="h-8 rounded-md border bg-background px-2 text-xs"
            onChange={(e) =>
              setFilter({
                ...filter,
                role: (e.target.value as ActivityFilter["role"]) || undefined,
              })
            }
          >
            <option value="">{t("activity.allRoles")}</option>
            {["ui-generation", "system-event", "maintenance", "image-generation"].map((role) => (
              <option key={role} value={role}>
                {t(`activity.role.${role}`)}
              </option>
            ))}
          </select>
        </div>

        {/* ---- runs table ---- */}
        <div className="min-h-32 flex-1 overflow-auto" onScroll={onScroll}>
          <div className="min-w-[660px]">
            <div
              className={cn(
                COLS,
                "sticky top-0 z-10 border-b bg-background px-5 py-1.5 text-[10px] font-medium uppercase text-muted-foreground",
              )}
            >
              <span>{t("activity.col.app")}</span>
              <span>{t("activity.col.summary")}</span>
              <span>{t("activity.col.model")}</span>
              <span>{t("activity.col.status")}</span>
              <span className="text-right">{t("activity.col.time")}</span>
              <span className="text-right">{t("activity.col.tokens")}</span>
              <span className="text-right">{t("activity.col.cost")}</span>
              <span className="text-right">{t("activity.col.action")}</span>
            </div>

            {runs.map((r) => (
              <RunRow key={r.id} r={r} t={t} onSelect={() => setSelected(r)} />
            ))}
          </div>
          {!loading && !runs.length && (
            <p className="p-5 text-center text-xs text-muted-foreground">
              {t(Object.values(filter).some(Boolean) ? "activity.noResults" : "activity.empty")}
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center justify-center gap-3 p-3 text-xs text-destructive"
            >
              {t(error)}
              <button className="underline" onClick={fetchMore}>
                {t("activity.retry")}
              </button>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("activity.loading")}
            </div>
          )}
          {hasMore && !loading && !error && (
            <button
              className="w-full py-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={fetchMore}
            >
              {t("activity.loadMore")}
            </button>
          )}
        </div>
      </div>
      {selected && (
        <RunDetails
          key={selected.id}
          initial={selected}
          content={content}
          onClose={() => setSelected(null)}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}

function RunRow({ r, t, onSelect }: { r: AgentRun; t: T; onSelect: () => void }) {
  const dur = r.endedAt ? `${((r.endedAt - r.startedAt) / 1000).toFixed(1)}s` : "·";
  const total = tok(r);
  return (
    <div
      className={cn(
        COLS,
        "items-center border-b border-border/50 px-5 py-2 text-[12px] transition-colors hover:bg-accent/30",
      )}
    >
      <button
        type="button"
        aria-label={`${t("activity.details")} · ${r.appName ?? t(`activity.role.${r.role}`)}`}
        onClick={onSelect}
        className="col-span-7 grid cursor-pointer grid-cols-subgrid items-center gap-2 text-left focus-visible:outline focus-visible:outline-ring"
      >
        <div className="min-w-0">
          <div className="truncate font-medium">{r.appName ?? t(`activity.role.${r.role}`)}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {t(`activity.role.${r.role}`)}
          </div>
        </div>
        <div
          className={cn(
            "min-w-0 truncate",
            r.status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {r.status === "error" ? r.error : (r.summary ?? "—")}
        </div>
        <div className="min-w-0 truncate text-[11px] text-muted-foreground" title={r.model}>
          {r.model ?? "—"}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={cn("size-1.5 shrink-0 rounded-full", DOT[r.status])} />
          <span className="truncate text-muted-foreground">{t(`activity.status.${r.status}`)}</span>
        </div>
        <div className="text-right tabular-nums text-muted-foreground">{dur}</div>
        <div className="text-right tabular-nums text-muted-foreground">
          {total ? fmtTokens(total) : "—"}
        </div>
        <div className="text-right tabular-nums text-muted-foreground">
          {fmtCost(r.costUsd ?? 0)}
        </div>
      </button>
      <div className="flex justify-end">
        {r.status === "running" ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              wsClient.send("c2s.activity.stop", { runId: r.id });
            }}
            title={t("activity.stop")}
            className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive hover:text-white"
          >
            <Square className="size-2.5" fill="currentColor" /> {t("activity.stop")}
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">—</span>
        )}
      </div>
    </div>
  );
}

function RunDetails({
  initial,
  content,
  onClose,
  onSelect,
}: {
  initial: AgentRun;
  content: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onSelect: (run: AgentRun) => void;
}) {
  const t = useT();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(true);
  const [details, setDetails] = useState<ActivityDetails | null>();
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    const el = dialog.current!;
    const opener = document.activeElement;
    const background = content.current!;
    // Only this app's contents are blocked; keep the OS and its window chrome usable.
    background.inert = true;
    el.show();
    let requestId: string | undefined;
    let refreshAgain = false;
    let timeout: ReturnType<typeof setTimeout>;
    let refreshTimer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (requestId) {
        refreshAgain = true;
        return;
      }
      requestId = crypto.randomUUID();
      if (!wsClient.send("c2s.activity.details", { runId: initial.id, requestId })) {
        requestId = undefined;
        setError("communication.disconnected");
        return;
      }
      timeout = setTimeout(() => {
        requestId = undefined;
        setError("communication.timeout");
      }, 15_000);
    };
    const schedule = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 80);
    };
    const off = wsClient.on("s2c.activity.details", (result) => {
      if (result.requestId !== requestId) return;
      clearTimeout(timeout);
      requestId = undefined;
      setDetails(result.details);
      setError(undefined);
      if (refreshAgain) {
        refreshAgain = false;
        schedule();
      }
    });
    const offChanged = wsClient.on("s2c.activity.changed", (result) => {
      if (result.traceId === (initial.traceId ?? initial.id)) schedule();
    });
    const offRun = wsClient.on("s2c.agent.run", ({ run }) => {
      if (run.id === initial.id || (run.traceId && run.traceId === initial.traceId)) schedule();
    });
    const offStatus = wsClient.onStatus((connected) => {
      clearTimeout(timeout);
      requestId = undefined;
      if (connected) refresh();
      else setError("communication.disconnected");
    });
    refresh();
    return () => {
      off();
      offChanged();
      offRun();
      offStatus();
      clearTimeout(timeout);
      clearTimeout(refreshTimer);
      background.inert = false;
      el.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        if (restoreFocus.current) opener.focus({ preventScroll: true });
        else opener.blur();
      }
    };
  }, [initial.id, initial.traceId, content]);
  const run = details?.run ?? initial;
  const reveal = async (path: string) => {
    try {
      await requestFiles({ action: "reveal", path });
      restoreFocus.current = false;
      onClose();
    } catch (e) {
      setError(`files.error.${e instanceof Error ? e.message : "failed"}`);
    }
  };
  const formatValue = (key: string, value: unknown) =>
    key === "status" && typeof value === "string"
      ? t(`activity.status.${value}`)
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return (
    <div
      className="vibe-activity-popup absolute inset-0 z-20 flex bg-black/20 p-3"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onCancel={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className="vibe-activity-dialog relative m-auto flex max-h-full w-full max-w-[700px] flex-col overflow-hidden rounded-lg border border-border bg-background p-0 text-foreground shadow-xl"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-xs font-semibold">
            {run.appName ?? t(`activity.role.${run.role}`)} · {t("activity.details")}
          </h2>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", DOT[run.status])} />
            {t(`activity.status.${run.status}`)}
          </span>
          <button
            aria-label={t("win.close")}
            onClick={onClose}
            className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </button>
        </header>
        <div className="min-h-0 select-text overflow-auto p-3 text-xs">
          {error && (
            <p role="alert" className="mb-3 text-destructive">
              {t(error)}
            </p>
          )}
          {details === undefined && !error && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("activity.loading")}
            </p>
          )}
          {details === null && <p className="text-muted-foreground">{t("activity.missing")}</p>}
          <p className="whitespace-pre-wrap break-words font-medium leading-relaxed">
            {run.summary ?? "—"}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{t(`activity.role.${run.role}`)}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate" title={run.model}>
              {run.model ?? "—"}
            </span>
            <time className="ml-auto tabular-nums" title={new Date(run.startedAt).toLocaleString()}>
              {new Date(run.startedAt).toLocaleTimeString()}
            </time>
          </div>
          {run.error && (
            <p className="mt-2 whitespace-pre-wrap break-words text-destructive">{run.error}</p>
          )}
          <dl className="my-3 grid grid-cols-3 divide-x border-y py-2 text-[10px] text-muted-foreground">
            <div className="pr-3">
              <dt>{t("activity.col.time")}</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
                {run.endedAt ? `${((run.endedAt - run.startedAt) / 1000).toFixed(2)}s` : "—"}
              </dd>
            </div>
            <div className="px-3">
              <dt>{t("activity.col.tokens")}</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
                {run.inputTokens == null && run.outputTokens == null ? "—" : fmtTokens(tok(run))}
              </dd>
            </div>
            <div className="pl-3">
              <dt>{t("activity.col.cost")}</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
                {fmtCost(run.costUsd ?? 0)}
              </dd>
            </div>
          </dl>
          <details className="mb-3 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              {t("activity.technicalDetails")}
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt>{t("activity.trace")}</dt>
              <dd className="break-all font-mono">{run.traceId ?? run.id}</dd>
              <dt>{t("activity.startedAt")}</dt>
              <dd>{new Date(run.startedAt).toLocaleString()}</dd>
              <dt>{t("activity.in")}</dt>
              <dd>{run.inputTokens ?? "—"}</dd>
              <dt>{t("activity.out")}</dt>
              <dd>{run.outputTokens ?? "—"}</dd>
            </dl>
          </details>
          {details && (
            <>
              <h3 className="mb-2 font-medium">
                {t("activity.relatedRuns")} · {details.relatedRuns.length}
              </h3>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {details.relatedRuns.map((r, index) => (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r)}
                    aria-current={r.id === run.id ? "true" : undefined}
                    className={cn(
                      "flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] hover:bg-accent",
                      r.id === run.id && "border-brand/50 bg-brand/10",
                    )}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", DOT[r.status])} />
                    <span className="truncate">
                      {index + 1}. {r.appName ?? t(`activity.role.${r.role}`)}
                    </span>
                  </button>
                ))}
              </div>
              <h3 className="mb-2 font-medium">
                {t("activity.steps")} · {details.logs.length}
              </h3>
              {!details.logs.length && (
                <p className="text-muted-foreground">{t("activity.noSteps")}</p>
              )}
              <ol className="ml-2.5">
                {details.logs.map((log, index) => {
                  const data =
                    log.data && typeof log.data === "object"
                      ? (log.data as Record<string, unknown>)
                      : {};
                  const actor = details.relatedRuns.find((r) => r.id === log.runId);
                  const entries = Object.entries(data).filter(
                    ([, value]) => value !== undefined && value !== null,
                  );
                  const technical = (key: string) =>
                    /id$|version|revision/i.test(key) || key === "from" || key === "to";
                  const fields = entries.filter(([key]) => key !== "path" && !technical(key));
                  const identifiers = entries.filter(([key]) => technical(key));
                  return (
                    <li
                      key={log.id}
                      className="relative border-l pl-4 pb-4 last:border-transparent last:pb-0"
                    >
                      <span
                        className={cn(
                          "absolute -left-2.5 top-0 flex size-5 items-center justify-center rounded-full border bg-background font-mono text-[9px] text-muted-foreground",
                          log.level === "error" && "border-destructive/50 text-destructive",
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="flex items-baseline justify-between gap-3">
                        <strong
                          className={cn("font-medium", log.level === "error" && "text-destructive")}
                        >
                          {t(`activity.step.${log.message}`)}
                        </strong>
                        <time
                          title={new Date(log.ts).toLocaleTimeString()}
                          className="shrink-0 font-mono text-[10px] text-muted-foreground"
                        >
                          +
                          {(
                            Math.max(0, log.ts - (details.logs[0]?.ts ?? run.startedAt)) / 1000
                          ).toFixed(2)}
                          s
                        </time>
                      </div>
                      {actor && actor.appName !== run.appName && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {actor.appName ?? t(`activity.role.${actor.role}`)}
                        </p>
                      )}
                      {typeof data.path === "string" && (
                        <button
                          className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded border bg-muted/30 px-2 py-1 text-left text-[11px] hover:border-brand/40 hover:text-brand"
                          onClick={() => void reveal(data.path as string)}
                          title={t("activity.reveal")}
                        >
                          <FolderOpen className="size-3 shrink-0" />
                          <span className="break-all">{data.path}</span>
                        </button>
                      )}
                      {fields.length > 0 && (
                        <dl className="mt-1.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-4 gap-y-1 text-[11px]">
                          {fields.map(([key, value]) => (
                            <div key={key} className="flex min-w-0 items-baseline gap-2">
                              <dt className="shrink-0 text-muted-foreground">
                                {t(`activity.field.${key}`)}
                              </dt>
                              <dd
                                className={cn(
                                  "min-w-0 break-words",
                                  key === "error" && "text-destructive",
                                )}
                              >
                                {formatValue(key, value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {identifiers.length > 0 && (
                        <details className="mt-1.5 text-[10px] text-muted-foreground">
                          <summary className="cursor-pointer rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                            {t("activity.technicalDetails")}
                          </summary>
                          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                            {identifiers.map(([key, value]) => (
                              <div key={key} className="contents">
                                <dt>{t(`activity.field.${key}`)}</dt>
                                <dd className="break-all font-mono">{formatValue(key, value)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
              {details.truncated && (
                <p className="mt-3 text-muted-foreground">{t("activity.truncated")}</p>
              )}
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[15px] font-semibold tabular-nums leading-none",
          warn && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground/70">{title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 rounded-[2px]", className)} />
      {label}
    </span>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmtCost(c: number): string {
  if (!c) return "—";
  if (c >= 1) return `$${c.toFixed(2)}`;
  if (c >= 0.01) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(4)}`;
}
