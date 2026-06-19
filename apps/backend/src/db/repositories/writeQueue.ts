/**
 * Single-writer lane. All DB mutations funnel through enqueue() so concurrent
 * agents + websocket handlers never contend on SQLite writes. Reads bypass this.
 */
let tail: Promise<unknown> = Promise.resolve();

export function enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // Keep the chain alive even if a write throws.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
