/** Generated image requests may outlive a connection; retry only local image assets. */
export function installImageRetries(root: HTMLElement) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onError = (event: Event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !/\/api\/img\//.test(img.src)) return;
    const count = Number(img.dataset.vibeRetry ?? "0");
    if (count >= 6) return;
    img.dataset.vibeRetry = String(count + 1);
    const base = img.src.replace(/[?&]r=\d+$/, "");
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (root.contains(img)) img.src = `${base}${base.includes("?") ? "&" : "?"}r=${count + 1}`;
    }, 1000 + count * 1500);
    timers.add(timer);
  };
  root.addEventListener("error", onError, true);
  return () => {
    root.removeEventListener("error", onError, true);
    for (const timer of timers) clearTimeout(timer);
  };
}
