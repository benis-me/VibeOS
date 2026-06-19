-- Per-API-provider configuration (key + base url + model list), JSON-encoded.
ALTER TABLE settings ADD COLUMN api_providers_json TEXT NOT NULL DEFAULT '{}';
