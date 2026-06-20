/**
 * Read an image File as a data URL, downscaling oversized images to keep the
 * stored wallpaper small and the desktop snappy. Large rasters are redrawn to
 * `maxW` wide and re-encoded as JPEG; small files pass through untouched.
 */
export async function fileToWallpaperDataUrl(file: File, maxW = 2560): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });

  // Tiny files or non-raster types (e.g. SVG) aren't worth re-encoding.
  if (file.size < 600_000 || !file.type.startsWith("image/")) return dataUrl;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = dataUrl;
  });
  if (img.naturalWidth <= maxW) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = maxW;
  canvas.height = Math.round((img.naturalHeight * maxW) / img.naturalWidth);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}
