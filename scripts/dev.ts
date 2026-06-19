/**
 * Dev orchestrator: runs the backend and the Vite frontend concurrently.
 * Usage: bun run dev
 */
import { spawn } from "node:child_process";

const procs: ReturnType<typeof spawn>[] = [];

function run(name: string, cwd: string, color: string) {
  // Strip a possibly-broken NODE_OPTIONS preload (some sandboxes inject one
  // that points at a path the spawned node can't resolve).
  const env = { ...process.env };
  if (env.NODE_OPTIONS?.includes("$bunfs")) delete env.NODE_OPTIONS;
  const p = spawn("bun", ["run", "dev"], { cwd, env, stdio: ["inherit", "pipe", "pipe"] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  p.stdout?.on("data", (d) => process.stdout.write(prefixLines(prefix, d.toString())));
  p.stderr?.on("data", (d) => process.stderr.write(prefixLines(prefix, d.toString())));
  p.on("exit", (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown();
  });
  procs.push(p);
}

function prefixLines(prefix: string, s: string): string {
  return s
    .split("\n")
    .map((l) => (l ? prefix + l : l))
    .join("\n");
}

function shutdown() {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("backend", "apps/backend", "36");
run("frontend", "apps/frontend", "35");
