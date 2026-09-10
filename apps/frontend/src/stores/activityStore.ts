import { create } from "zustand";
import type { AgentRun, ActivityFilter } from "@vibeos/shared";
import { ulid } from "@vibeos/shared/util";
import { wsClient } from "@/lib/ws";

const PAGE = 40;
const order = (a: AgentRun, b: AgentRun) => b.startedAt - a.startedAt || b.id.localeCompare(a.id);
function matches(run: AgentRun, filter: ActivityFilter) {
  return (
    (!filter.status || run.status === filter.status) &&
    (!filter.role || run.role === filter.role) &&
    [run.appName, run.model, run.summary, run.error, run.traceId, run.id]
      .join(" ")
      .toLowerCase()
      .includes(filter.query?.trim().toLowerCase() ?? "")
  );
}
interface ActivityState {
  runs: AgentRun[];
  filter: ActivityFilter;
  hasMore: boolean;
  loading: boolean;
  error?: string;
  requestId?: string;
  cursor?: { startedAt: number; id: string };
  setAll: (runs: AgentRun[]) => void;
  setFilter: (filter: ActivityFilter) => void;
  appendPage: (runs: AgentRun[], hasMore: boolean, requestId?: string) => void;
  upsert: (run: AgentRun) => void;
  fetchMore: () => void;
}

let timeout: ReturnType<typeof setTimeout>;
export const useActivityStore = create<ActivityState>((set, get) => ({
  runs: [],
  filter: {},
  hasMore: false,
  loading: false,
  setAll: (runs) => {
    clearTimeout(timeout);
    if (Object.values(get().filter).some(Boolean)) return get().setFilter(get().filter);
    const sorted = [...runs].sort(order);
    set({
      runs: sorted,
      cursor: sorted.at(-1),
      hasMore: runs.length >= 50,
      loading: false,
      requestId: undefined,
      error: undefined,
    });
  },
  setFilter: (filter) => {
    clearTimeout(timeout);
    set({ filter, runs: [], cursor: undefined, hasMore: true, loading: false, error: undefined });
    get().fetchMore();
  },
  appendPage: (runs, hasMore, requestId) => {
    if (!requestId || requestId !== get().requestId) return;
    clearTimeout(timeout);
    const seen = new Set(get().runs.map((r) => r.id));
    set({
      runs: [...get().runs, ...runs.filter((r) => !seen.has(r.id))].sort(order),
      cursor: runs.at(-1) ?? get().cursor,
      hasMore,
      loading: false,
      requestId: undefined,
      error: undefined,
    });
  },
  upsert: (run) =>
    set((s) => ({
      runs: [
        ...s.runs.filter((r) => r.id !== run.id),
        ...(matches(run, s.filter) ? [run] : []),
      ].sort(order),
    })),
  fetchMore: () => {
    const s = get();
    if (s.loading || !s.hasMore) return;
    const requestId = ulid();
    set({ loading: true, requestId, error: undefined });
    if (
      !wsClient.send("c2s.activity.fetch", {
        before: s.cursor?.startedAt,
        beforeId: s.cursor?.id,
        limit: PAGE,
        filter: s.filter,
        requestId,
      })
    ) {
      set({ loading: false, requestId: undefined, error: "communication.disconnected" });
      return;
    }
    timeout = setTimeout(
      () => set({ loading: false, requestId: undefined, error: "communication.timeout" }),
      15_000,
    );
  },
}));

wsClient.onStatus((connected) => {
  if (!connected && useActivityStore.getState().loading) {
    clearTimeout(timeout);
    useActivityStore.setState({
      loading: false,
      requestId: undefined,
      error: "communication.disconnected",
    });
  }
});
