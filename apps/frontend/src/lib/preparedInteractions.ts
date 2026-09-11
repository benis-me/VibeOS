import { localActionSchema, type LocalAction, type ViewState } from "@vibeos/shared";

function apply(root: HTMLElement, command: LocalAction, value?: string): boolean {
  const target = root.querySelector<HTMLElement>(
    `[data-vibeos-local-id="${CSS.escape(command.target)}"]`,
  );
  if (command.action === "select") {
    const panels = [
      ...root.querySelectorAll<HTMLElement>(
        `[data-vibeos-group="${CSS.escape(command.target)}"][data-vibeos-panel]`,
      ),
    ];
    if (!panels.some((el) => el.dataset.vibeosPanel === command.value)) return false;
    for (const el of panels) el.hidden = el.dataset.vibeosPanel !== command.value;
    for (const control of root.querySelectorAll<HTMLElement>("[data-vibeos-local]")) {
      try {
        const c = JSON.parse(control.dataset.vibeosLocal!);
        if (c.action === "select" && c.target === command.target) {
          control.setAttribute("aria-selected", String(c.value === command.value));
          if (control.getAttribute("role") === "tab")
            control.tabIndex = c.value === command.value ? 0 : -1;
        }
      } catch {
        /* Invalid commands fall back to AI when clicked. */
      }
    }
    return true;
  }
  if (!target) return false;
  if (command.action === "show" || command.action === "hide" || command.action === "toggle") {
    target.hidden = command.action === "hide" || (command.action === "toggle" && !target.hidden);
  } else {
    const items = [...target.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-vibeos-item"),
    );
    if (command.action === "filter") {
      const text = (value ?? "").trim().toLocaleLowerCase();
      for (const item of items)
        item.hidden = !(item.dataset.vibeosSearch ?? item.textContent ?? "")
          .toLocaleLowerCase()
          .includes(text);
    } else if (command.action === "sort") {
      items.sort(
        (a, b) =>
          (a.dataset.vibeosSort ?? a.textContent ?? "").localeCompare(
            b.dataset.vibeosSort ?? b.textContent ?? "",
            undefined,
            { numeric: true },
          ) * (command.direction === "desc" ? -1 : 1),
      );
      target.append(...items);
    }
  }
  return true;
}

export function restorePrepared(root: HTMLElement, state: ViewState) {
  const details = state.$details;
  if (details && typeof details === "object" && !Array.isArray(details))
    for (const [id, open] of Object.entries(details))
      if (typeof open === "boolean") {
        const el = root.querySelector<HTMLDetailsElement>(
          `details[data-vibeos-local-id="${CSS.escape(id)}"]`,
        );
        if (el) el.open = open;
      }
  const saved = state.$local;
  if (!saved || Array.isArray(saved) || typeof saved !== "object") return;
  for (const entry of Object.values(saved)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const c = localActionSchema.safeParse(entry.command);
    if (c.success) apply(root, c.data, typeof entry.value === "string" ? entry.value : undefined);
  }
}

export function runPrepared(
  root: HTMLElement,
  el: HTMLElement,
  value: string | undefined,
  state: ViewState,
  current: boolean,
): ViewState | undefined {
  if (el.dataset.vibeosPrefetch === "true" && !current) return;
  // Native disclosure remains immediate; explicit AI actions still take precedence.
  if (
    el.tagName === "SUMMARY" &&
    el.parentElement instanceof HTMLDetailsElement &&
    !el.dataset.vibeosLocal &&
    !el.dataset.vibeosCommand &&
    (!el.dataset.vibeosAction || el.dataset.vibeosPrefetch === "true")
  ) {
    const details = el.parentElement;
    details.open = !details.open;
    const id = details.dataset.vibeosLocalId;
    if (!id) return state;
    const prior = state.$details;
    return {
      ...state,
      $details: {
        ...(prior && typeof prior === "object" && !Array.isArray(prior) ? prior : {}),
        [id]: details.open,
      },
    };
  }
  if (!el.dataset.vibeosLocal) return;
  try {
    const command = localActionSchema.parse(JSON.parse(el.dataset.vibeosLocal));
    if (!apply(root, command, value)) return;
    const stored =
      command.action === "toggle"
        ? {
            ...command,
            action: root.querySelector<HTMLElement>(
              `[data-vibeos-local-id="${CSS.escape(command.target)}"]`,
            )!.hidden
              ? "hide"
              : "show",
          }
        : command;
    const prior =
      state.$local && typeof state.$local === "object" && !Array.isArray(state.$local)
        ? state.$local
        : {};
    const key = `${command.action === "select" ? "select" : command.action === "filter" ? "filter" : command.action === "sort" ? "sort" : "visible"}:${command.target}`;
    return {
      ...state,
      $local: {
        ...prior,
        [key]: { command: stored, ...(value === undefined ? {} : { value }) },
      },
    };
  } catch {
    return;
  }
}
