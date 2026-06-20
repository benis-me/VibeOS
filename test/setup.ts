// Test bootstrap, run via bunfig.toml `[test] preload` BEFORE any test module
// is imported. env.ts reads these at load time, so they must be set here:
//  - point the DB at a throwaway file so tests never touch the dev database
//  - force the offline AI stub and disable background agents (no network/models)
process.env.VIBEOS_DB_PATH ||= `/tmp/vibeos-test-${process.pid}.db`;
process.env.VIBEOS_AI_STUB ||= "1";
process.env.VIBEOS_AGENTS_DISABLED ||= "1";
