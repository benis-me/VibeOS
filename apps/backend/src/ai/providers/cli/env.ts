/**
 * Environment for spawned agent CLIs. The node-based CLIs (claude / codebuddy)
 * read NODE_OPTIONS; some sandboxes inject a preload pointing at a `$bunfs` path
 * the spawned node can't resolve, which crashes it on startup — so strip it.
 * Everything else (auth, PATH) is inherited so the CLI's own login works.
 */
export function cliEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (env.NODE_OPTIONS?.includes("$bunfs")) {
    delete env.NODE_OPTIONS;
  }
  return env;
}
