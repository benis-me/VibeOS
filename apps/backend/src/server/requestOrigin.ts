import { env } from "../config/env.ts";

const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);

/** The browser's real filesystem bridge is only available to the VibeOS frontend. */
export function allowedOrigin(req: Request): boolean {
  const target = new URL(req.url);
  const origin = req.headers.get("Origin");
  if (!origin) return req.headers.get("Sec-Fetch-Site") !== "cross-site";
  if (origin === process.env.VIBEOS_WEB_ORIGIN) return true;
  try {
    const source = new URL(origin);
    return (
      loopback(target.hostname) &&
      loopback(source.hostname) &&
      source.protocol === target.protocol &&
      (source.port === target.port || Number(source.port) === env.port + 10)
    );
  } catch {
    return false;
  }
}
