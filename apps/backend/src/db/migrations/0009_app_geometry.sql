-- Remembered window geometry per app, restored when the app is reopened.
CREATE TABLE IF NOT EXISTS app_geometry (
  app_id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
