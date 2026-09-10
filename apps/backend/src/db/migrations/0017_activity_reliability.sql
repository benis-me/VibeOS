ALTER TABLE app_memory ADD COLUMN consolidated_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN trace_id TEXT;
ALTER TABLE agent_runs ADD COLUMN window_id TEXT;
ALTER TABLE agent_runs ADD COLUMN app_id TEXT;
ALTER TABLE agent_logs ADD COLUMN trace_id TEXT;
CREATE INDEX idx_agent_runs_trace ON agent_runs(trace_id, started_at, id);
CREATE INDEX idx_agent_logs_trace ON agent_logs(trace_id, ts, id);
