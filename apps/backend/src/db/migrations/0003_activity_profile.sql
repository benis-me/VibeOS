-- Activity Monitor: per-run token usage + cost.
ALTER TABLE agent_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN cost_usd REAL;

-- Global user profile/memory the AI sees on every generation.
ALTER TABLE settings ADD COLUMN user_profile TEXT;
