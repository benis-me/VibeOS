CREATE TABLE app_subscriptions (
  window_id TEXT NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('html', 'command')),
  definition_json TEXT NOT NULL,
  PRIMARY KEY (window_id, origin, id)
);
