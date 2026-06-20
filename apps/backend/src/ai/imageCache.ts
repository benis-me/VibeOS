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

function ensureImage(id: string, provider: string, model: string, aspect: string, prompt: string): void {
  if (hasImage(id) || inflight.has(id)) return;
  log.debug(`generating ${id} (${provider}/${model}, ${aspect})`);
  // Track each generation as an AgentRun so it shows in the Activity Monitor.
  const p = (async () => {
    const run = await AgentRepo.startRun({
      role: "image-generation",
      trigger: "event",
      model: `${provider}/${model}`,
      appName: "ImageGen",
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

// Tolerant of whitespace around `=` (some models emit `attr = "value"`).
const IMG_TAG = /<img\b[^>]*\bdata-vibe-img\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi;

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
  const out = html.replace(IMG_TAG, (tag, _q, rawPrompt) => {
    // Skip ONLY images we already resolved. A src the AI invented (a placeholder
    // / fake URL, despite the directive) must NOT block generation — strip it.
    if (/\bsrc\s*=\s*["'][^"']*\/api\/img\//i.test(tag)) return tag;
    const prompt = decodeEntities(String(rawPrompt)).trim();
    if (!prompt) return tag;
    matched++;
    const ratio = decodeEntities(tag.match(/\bdata-vibe-ratio\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? "1:1");
    const id = imageId(im.provider!, im.model!, ratio, prompt);
    ensureImage(id, im.provider!, im.model!, ratio, prompt);
    const stripped = tag.replace(/\ssrc\s*=\s*(["'])[\s\S]*?\1/i, "");
    return stripped.replace(/^<img\b/i, `<img src="/api/img/${id}"`);
  });
  if (hasTag && matched === 0) {
    log.warn("data-vibe-img present but matched 0 images — unexpected <img> attribute format");
  } else if (matched) {
    log.debug(`rewriteImages: ${matched} image(s) → ${im.provider}/${im.model}`);
  }
  return out;
}
