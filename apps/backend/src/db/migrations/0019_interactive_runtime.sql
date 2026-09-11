ALTER TABLE app_versions ADD COLUMN runtime TEXT NOT NULL DEFAULT 'html';
ALTER TABLE app_requests ADD COLUMN runtime TEXT NOT NULL DEFAULT 'html';
ALTER TABLE windows ADD COLUMN view_state_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE app_memory ADD COLUMN data_version TEXT;
