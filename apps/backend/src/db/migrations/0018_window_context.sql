ALTER TABLE windows ADD COLUMN opener_window_id TEXT REFERENCES windows(id) ON DELETE SET NULL;
ALTER TABLE windows ADD COLUMN launch_context_json TEXT;
