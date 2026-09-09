DROP INDEX skin_one_running_request;
CREATE UNIQUE INDEX skin_one_running_request ON skin_requests(skin_id) WHERE status IN ('generating', 'validating', 'assets', 'refining');
