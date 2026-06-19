import { createHash } from "node:crypto";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";
import { getImage, hasImage, putImage } from "../db/repositories/ImagesRepo.ts";
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
  const p = generateImage(provider, model, prompt, aspect)
    .then(async (r) => {
      await putImage({ id, prompt, model, mime: r.mime, bytes: r.bytes });
      inflight.delete(id);
      log.info(`✓ image ${id} (${r.bytes.length} bytes)`);
      return r;
    })
    .catch((e) => {
      inflight.delete(id);
      log.warn(`image ${id} failed: ${e instanceof Error ? e.message : e}`);
      throw e;
    });
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

const IMG_TAG = /<img\b[^>]*\bdata-vibe-img=(["'])([\s\S]*?)\1[^>]*>/gi;

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
  const im = loadSettings().prefs.imageModel;
  if (!im?.provider || !im?.model) return html;
  return html.replace(IMG_TAG, (tag, _q, rawPrompt) => {
    if (/\ssrc=/i.test(tag)) return tag; // already resolved
    const prompt = decodeEntities(String(rawPrompt)).trim();
    if (!prompt) return tag;
    const ratio = decodeEntities(tag.match(/\bdata-vibe-ratio=(["'])([\s\S]*?)\1/i)?.[2] ?? "1:1");
    const id = imageId(im.provider!, im.model!, ratio, prompt);
    ensureImage(id, im.provider!, im.model!, ratio, prompt);
    return tag.replace(/^<img\b/i, `<img src="/api/img/${id}"`);
  });
}
