/**
 * Tiny structured logger with millisecond timestamps and a tag. Set
 * VIBEOS_LOG_LEVEL=debug for verbose output (default: info).
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.VIBEOS_LOG_LEVEL as Level) ?? "debug"] ?? ORDER.debug;

const COLOR: Record<Level, string> = {
  debug: "90", // gray
  info: "36", // cyan
  warn: "33", // yellow
  error: "31", // red
};

function ts(): string {
  const d = new Date();
  return d.toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function emit(level: Level, tag: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const head = `\x1b[${COLOR[level]}m${ts()} ${level.toUpperCase().padEnd(5)} [${tag}]\x1b[0m`;
  if (extra !== undefined) {
    console.log(head, msg, typeof extra === "string" ? extra : safe(extra));
  } else {
    console.log(head, msg);
  }
}

function safe(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 600 ? `${s.slice(0, 600)}…` : (s ?? String(v));
  } catch {
    return String(v);
  }
}

export function logger(tag: string) {
  return {
    debug: (m: string, e?: unknown) => emit("debug", tag, m, e),
    info: (m: string, e?: unknown) => emit("info", tag, m, e),
    warn: (m: string, e?: unknown) => emit("warn", tag, m, e),
    error: (m: string, e?: unknown) => emit("error", tag, m, e),
  };
}
