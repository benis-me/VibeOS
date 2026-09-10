ALTER TABLE apps ADD COLUMN active_version_id TEXT;
ALTER TABLE apps ADD COLUMN origin_app_id TEXT;
ALTER TABLE windows ADD COLUMN app_version_id TEXT;
CREATE TABLE app_versions (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id), number INTEGER NOT NULL,
  path TEXT NOT NULL, summary TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
  legacy INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  UNIQUE(app_id, number)
);
CREATE TABLE app_requests (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id), prompt TEXT NOT NULL,
  base_version_id TEXT NOT NULL, source_window_id TEXT, data_version TEXT NOT NULL,
  status TEXT NOT NULL, chars INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '',
  error TEXT, version_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX app_one_running_request ON app_requests(app_id) WHERE status IN ('generating', 'validating');
CREATE TABLE system_memory (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO system_memory (id, revision) VALUES (1, 0);
