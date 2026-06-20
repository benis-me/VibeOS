import { createHash } from "node:crypto";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";
import { getImage, hasImage, putImage } from "../db/repositories/ImagesRepo.ts";
import * as AgentRepo from "../db/repositories/AgentRepo.ts";
import { broadcast } from "../server/wsGateway.ts";
import { generateImage, type GeneratedImage } from "./imageGen.ts";
import { logger } from "../util/log.ts";

const log = logger("image");

/** Generations in flight, keyed by content id, so /api/img/:id can await them. */
const inflight = new Map<string, Promise<GeneratedImage>>();

/** Stable content id: identical (model, ratio, prompt) never regenerates. */
export function imageId(provider: string, model: string, aspect: string, prompt: string): string {
  return createHash("sha256").update(`${provider}|${model}|${aspect}|${prompt}`).digest("hex").slice(0, 32);
}

function ensureImage(
  id: string,
  provider: string,
  model: string,
  aspect: string,
  prompt: string,
  appName = "ImageGen",
): void {
  if (hasImage(id) || inflight.has(id)) return;
  log.debug(`generating ${id} (${provider}/${model}, ${aspect})`);
  // Track each generation as an AgentRun so it shows in the Activity Monitor.
  const p = (async () => {
    const run = await AgentRepo.startRun({
      role: "image-generation",
      trigger: "event",
      model: `${provider}/${model}`,
      appName,
    });
    broadcast("s2c.agent.run", { run });
    try {
      const r = await generateImage(provider, model, prompt, aspect);
      await putImage({ id, prompt, model, mime: r.mime, bytes: r.bytes });
      const done = await AgentRepo.endRun(run.id, "ok");
      if (done) broadcast("s2c.agent.run", { run: done });
      log.info(`✓ image ${id} (${r.bytes.length} bytes)`);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const done = await AgentRepo.endRun(run.id, "error", msg);
      if (done) broadcast("s2c.agent.run", { run: done });
      log.warn(`image ${id} failed: ${msg}`);
      throw e;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
}

/** Serve a stored image, or await an in-flight generation for it (then serve). */
export async function getImageForServe(id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const stored = getImage(id);
  if (stored) return stored;
  const p = inflight.get(id);
  if (p) {
    try {
      return await p;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Kick off generation of a desktop wallpaper (16:9) with the configured image
 * model and return its `/api/img/:id` path. Returns null when no image model is
 * configured. Generation runs in the background (tracked in the Activity
 * Monitor); the path serves once the route awaits it.
 */
export function requestWallpaper(prompt: string): string | null {
  const im = loadSettings().prefs.imageModel;
  if (!im?.provider || !im?.model) return null;
  const aspect = "16:9";
  const id = imageId(im.provider, im.model, aspect, prompt);
  ensureImage(id, im.provider, im.model, aspect, prompt, "Wallpaper");
  return `/api/img/${id}`;
}

/**
 * Store an uploaded image (a `data:` URL) under a content-addressed id and
 * return its `/api/img/:id` path. Returns null if the data URL can't be parsed.
 */
export async function storeUpload(dataUrl: string): Promise<string | null> {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "image/png";
  const body = m[3] ?? "";
  const bytes = m[2]
    ? new Uint8Array(Buffer.from(body, "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(body)));
  if (!bytes.length) return null;
  const id = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  await putImage({ id, prompt: "(upload)", model: "(upload)", mime, bytes });
  log.info(`✓ wallpaper upload ${id} (${bytes.length} bytes, ${mime})`);
  return `/api/img/${id}`;
}

// Match ANY element carrying data-vibe-img (models use <img> but also <div>).
// Optionally consume an immediately-following close tag so empty placeholders
// like `<div data-vibe-img …></div>` convert cleanly to a real <img>.
// Tolerant of whitespace around `=` (some models emit `attr = "value"`).
const VIBE_IMG = /<([a-z][\w-]*)\b([^>]*\bdata-vibe-img\s*=\s*(["'])([\s\S]*?)\3[^>]*)>(?:\s*<\/\1\s*>)?/gi;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Rewrite `<img data-vibe-img="…" data-vibe-ratio="16:9">` (no src) to point at
 * /api/img/:id and kick off generation for any not-yet-cached image. No-op when
 * no image model is configured. Synchronous string rewrite; generation runs in
 * the background and the route awaits it.
 */
export function rewriteImages(html: string): string {
  const hasTag = /data-vibe-img/i.test(html);
  const im = loadSettings().prefs.imageModel;
  if (!im?.provider || !im?.model) {
    if (hasTag) {
      log.warn("data-vibe-img present but NO image model configured — set Settings → Default Models → Image");
    }
    return html;
  }
  let matched = 0;
  const out = html.replace(VIBE_IMG, (whole, _tag, attrs: string, _q, rawPrompt) => {
    // Skip what we already resolved (src/background already points at /api/img/).
    if (/\/api\/img\//i.test(attrs)) return whole;
    const prompt = decodeEntities(String(rawPrompt)).trim();
    if (!prompt) return whole;
    matched++;
    const ratio = decodeEntities(attrs.match(/\bdata-vibe-ratio\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? "1:1");
    const id = imageId(im.provider!, im.model!, ratio, prompt);
    ensureImage(id, im.provider!, im.model!, ratio, prompt);
    // Normalize to a real <img>: carry over the element's attributes (minus any
    // src the AI invented), so <div data-vibe-img>…</div> placeholders become
    // images whose object-fit/size/radius styles now actually apply.
    const a = attrs.replace(/\ssrc\s*=\s*(["'])[\s\S]*?\1/i, "");
    return `<img src="/api/img/${id}"${a}>`;
  });
  if (hasTag && matched === 0) {
    log.warn("data-vibe-img present but matched 0 images — unexpected <img> attribute format");
  } else if (matched) {
    log.debug(`rewriteImages: ${matched} image(s) → ${im.provider}/${im.model}`);
  }
  return out;
}
