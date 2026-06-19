import type { ProviderId } from "@vibeos/shared/domain";
import { providerConfig } from "./providers/config.ts";

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: string;
}

function orientation(aspect: string): "landscape" | "portrait" | "square" {
  const m = aspect.match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return "square";
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > h ? "landscape" : h > w ? "portrait" : "square";
}

const openaiSize = (a: string) =>
  orientation(a) === "landscape" ? "1536x1024" : orientation(a) === "portrait" ? "1024x1536" : "1024x1024";
const falSize = (a: string) =>
  orientation(a) === "landscape" ? "landscape_16_9" : orientation(a) === "portrait" ? "portrait_16_9" : "square_hd";

async function fromUrlOrData(url: string): Promise<GeneratedImage> {
  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;]+);base64,(.*)$/);
    if (!m || !m[1] || !m[2]) throw new Error("malformed data URL");
    return { bytes: Buffer.from(m[2], "base64"), mime: m[1] };
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`image fetch ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type") ?? "image/jpeg" };
}

const short = (s: string) => s.slice(0, 200);

/**
 * Generate one image via the chosen provider+model. Direct HTTP per provider so
 * we can target the exact current image models regardless of SDK coverage.
 */
export async function generateImage(
  provider: string,
  model: string,
  prompt: string,
  aspect: string,
): Promise<GeneratedImage> {
  const { apiKey, baseUrl } = providerConfig(provider as ProviderId);
  if (!apiKey) throw new Error(`No API key for ${provider}`);
  const signal = AbortSignal.timeout(90_000);
  const json = { "Content-Type": "application/json" };

  if (provider === "openai") {
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      body: JSON.stringify({ model, prompt, size: openaiSize(aspect), n: 1 }),
      signal,
    });
    if (!res.ok) throw new Error(`openai image ${res.status}: ${short(await res.text().catch(() => ""))}`);
    const j = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("openai: no image data");
    return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
  }

  if (provider === "gemini") {
    const res = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, ...json },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt} (aspect ratio ${aspect})` }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`gemini image ${res.status}: ${short(await res.text().catch(() => ""))}`);
    const j = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
    };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("gemini: no image data");
    return { bytes: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType ?? "image/png" };
  }

  if (provider === "openrouter") {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, ...json },
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: `${prompt} (aspect ratio ${aspect})` }],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`openrouter image ${res.status}: ${short(await res.text().catch(() => ""))}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("openrouter: no image returned");
    return fromUrlOrData(url);
  }

  if (provider === "fal") {
    const res = await fetch(`${baseUrl}/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, ...json },
      body: JSON.stringify({ prompt, image_size: falSize(aspect), num_images: 1 }),
      signal,
    });
    if (!res.ok) throw new Error(`fal image ${res.status}: ${short(await res.text().catch(() => ""))}`);
    const j = (await res.json()) as { images?: Array<{ url?: string }> };
    const url = j.images?.[0]?.url;
    if (!url) throw new Error("fal: no image returned");
    return fromUrlOrData(url);
  }

  throw new Error(`Image generation not supported for provider "${provider}"`);
}
