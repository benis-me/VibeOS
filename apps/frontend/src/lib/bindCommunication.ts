import type { AppDelivery } from "@vibeos/shared";

/** Bind only literal text. No selectors, HTML interpolation or executable expressions. */
export function bindCommunication(
  root: HTMLElement,
  delivery: AppDelivery,
  translate: (key: string) => string,
) {
  if (!delivery.channel || delivery.mode !== "data") return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-vibeos-bind]")) {
    const binding = el.dataset.vibeosBind ?? "";
    if (
      (binding !== delivery.channel &&
        !binding.startsWith(delivery.channel + ".")) ||
      el.matches("input,textarea,select,script,style")
    )
      continue;
    const keys =
      binding === delivery.channel
        ? []
        : binding.slice(delivery.channel.length + 1).split(".");
    let value: unknown = delivery.data;
    if (keys[0] === "$error")
      value = delivery.error ? translate(delivery.error) : "";
    else
      for (const key of keys) {
        value =
          value &&
          typeof value === "object" &&
          !["__proto__", "prototype", "constructor"].includes(key) &&
          Object.hasOwn(value, key)
            ? (value as Record<string, unknown>)[key]
            : undefined;
      }
    el.textContent =
      value == null
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2);
  }
}
