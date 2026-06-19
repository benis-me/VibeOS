-- Activity Monitor: which app a run was for, and a summary of what it produced.
ALTER TABLE agent_runs ADD COLUMN app_name TEXT;
ALTER TABLE agent_runs ADD COLUMN summary TEXT;
