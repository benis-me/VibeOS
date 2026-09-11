import { useEffect, type RefObject } from "react";
import type { AiOp } from "@vibeos/shared/protocol";
import { ulid } from "@vibeos/shared/util";
import { fieldKey, fieldValue, type Field, type createDrafts } from "@/lib/fields";

function collectDataset(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(el.dataset)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Collect current values of value-bearing fields within a scope, keyed by a
 * stable-ish name. Used to attach typed input content to a click that ISN'T a
 * native form submit — the AI very often renders a bare `<input>` + `<button>`
 * with no `<form>`, so without this the agent regenerates blind to what was
 * typed. `primary` is the first non-empty text value, surfaced explicitly.
 */
function collectFields(scope: HTMLElement): {
  fields: Record<string, string>;
  primary: string;
} {
  const fields: Record<string, string> = Object.create(null);
  let primary = "";
  const els = scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  for (const f of els) {
    const type = ((f as HTMLInputElement).type || "text").toLowerCase();
    if (/^(button|submit|reset|image|file)$/.test(type)) continue;
    const val =
      type === "checkbox" || type === "radio" ? String((f as HTMLInputElement).checked) : f.value;
    const key = fieldKey(f);
    if (key && fields[key] === undefined) fields[key] = val;
    if (
      !primary &&
      (f.tagName === "TEXTAREA" || /^(text|search|email|tel|url|number|password|)$/.test(type))
    ) {
      primary = val;
    }
  }
  return { fields, primary };
}

/**
 * Nearest ancestor of `el` (up to and including root) that contains a
 * value-bearing field — the tightest group whose inputs belong with this op.
 * Returns null when there are no fields around (e.g. a calculator keypad).
 */
function nearestFieldScope(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  const FIELD =
    "input:not([type='button']):not([type='submit']):not([type='reset']), textarea, select";
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    if (cur.querySelector(FIELD)) return cur;
    if (cur === root) break;
    cur = cur.parentElement;
  }
  return null;
}

/** Selectors for elements that should behave as interactive (trigger the AI). */
const INTERACTIVE =
  "[data-vibeos-action],[data-vibeos-local],a,button,[role='button'],[role='link'],[role='menuitem'],[role='tab'],[role='option'],summary,label[for],li[data-id],li[onclick],.clickable,[data-clickable]";

/**
 * Walk up from the event target to the nearest element that *looks*
 * interactive. We don't require data-vibeos-action — if the AI rendered a
 * <button>/<a>/etc. without it, we still treat the click as an operation so
 * everything that looks clickable actually does something.
 */
function findInteractive(start: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let el = start as HTMLElement | null;
  while (el && el !== root) {
    if (el.matches?.(INTERACTIVE)) return el;
    el = el.parentElement;
  }
  return null;
}

/** A short, AI-friendly description of what was clicked, for context. */
function describe(el: HTMLElement): string {
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const aria = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
  const href = el.getAttribute("href") ?? "";
  const tag = el.tagName.toLowerCase();
  return [tag, aria, text, href && `href=${href}`].filter(Boolean).join(" | ");
}

/**
 * Installs one delegated listener set on the surface. Any interaction with an
 * interactive-looking element becomes a typed AiOp sent upstream. No inline
 * handlers from the AI ever execute (sanitizer strips them).
 */
export function useDelegatedEvents(
  ref: RefObject<HTMLElement | null>,
  onOp: (op: AiOp, scope: HTMLElement) => void,
  drafts?: ReturnType<typeof createDrafts>,
  local?: (el: HTMLElement, op: AiOp) => boolean,
): void {
  useEffect(() => {
    const root = ref.current;
    if (root) return installDelegatedEvents(root, onOp, drafts, local);
  }, [ref, onOp, drafts, local]);
}

export function installDelegatedEvents(
  root: HTMLElement,
  onOp: (op: AiOp, scope: HTMLElement) => void,
  drafts?: ReturnType<typeof createDrafts>,
  local?: (el: HTMLElement, op: AiOp) => boolean,
  trustedInputOnly = false,
): () => void {
  const emit = (el: HTMLElement, op: AiOp) => {
    if (local?.(el, op)) return;
    const regionPath: string[] = [];
    for (let cur: HTMLElement | null = el; cur && cur !== root; cur = cur.parentElement) {
      if (cur.dataset.vibeosRegion) regionPath.push(cur.dataset.vibeosRegion);
    }
    const scope = el.closest("form") ?? nearestFieldScope(el, root) ?? root;
    const fields = collectFields(scope).fields;
    onOp(
      {
        ...op,
        id: ulid(),
        formData: op.formData ?? fields,
        userInput: drafts?.input(scope),
        regionPath,
      },
      scope,
    );
  };

  const submitForm = (form: HTMLFormElement, action?: string, origin: HTMLElement = form) => {
    const fd: Record<string, string> = Object.create(null);
    // 1) named fields via FormData
    new FormData(form).forEach((v, k) => {
      if (typeof v === "string") fd[k] = v;
    });
    // 2) belt-and-suspenders: collect EVERY input/textarea/select value, even
    // unnamed ones, keyed by name → action → placeholder. AI often omits name.
    const fields = form.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input, textarea, select");
    let primary = "";
    for (const f of fields) {
      const key = fieldKey(f);
      if (key && fd[key] === undefined) fd[key] = fieldValue(f);
      // remember the first non-empty text value as the "primary" input
      if (!primary && f.value && /^(INPUT|TEXTAREA)$/.test(f.tagName)) primary = f.value;
    }
    emit(origin, {
      kind: "submit",
      action: action ?? form.dataset.vibeosAction ?? "submit",
      // surface the main value explicitly so the AI can't miss it
      value: primary,
      dataset: { ...collectDataset(form), ...collectDataset(origin) },
      formData: fd,
    });
  };

  const onClick = (e: MouseEvent) => {
    const tgt = e.target as HTMLElement;

    // A click on an EDITABLE control (text field / textarea / contenteditable)
    // must ALWAYS pass through natively so the user can focus and type — even
    // if an ancestor carries data-vibeos-action. Focusing an input is never an
    // "action". (Buttons/checkboxes/radios are not editable → not skipped.)
    const tag = tgt.tagName;
    const editable =
      tag === "TEXTAREA" ||
      tgt.isContentEditable ||
      (tag === "INPUT" &&
        !/^(button|submit|checkbox|radio|reset|range|color|file|image)$/.test(
          (tgt as HTMLInputElement).type || "text",
        ));
    if (editable) return;
    // Let the browser update toggles and open native pickers; change emits once.
    if (
      tgt.matches(
        "input[type=checkbox],input[type=radio],input[type=range],input[type=color],input[type=file],select,option",
      )
    )
      return;

    // Use the actual submitter, even when only its surrounding form has an action.
    const submitter = tgt.closest<HTMLButtonElement | HTMLInputElement>(
      "button,input[type=submit],input[type=image]",
    );
    if (submitter?.form && /^(submit|image)$/.test(submitter.type)) {
      if (submitter.disabled || submitter.getAttribute("aria-disabled") === "true") return;
      e.preventDefault();
      submitter.form.requestSubmit(submitter);
      return;
    }

    // Otherwise, the nearest element carrying an explicit action wins.
    const actionEl = tgt.closest<HTMLElement>(
      "[data-vibeos-action]:not(form),[data-vibeos-command]:not(form),[data-vibeos-local]:not(form)",
    );
    const el = actionEl ?? findInteractive(e.target, root);
    if (!el) return;
    if (el.matches(":disabled,[aria-disabled='true']")) return;
    if (
      tgt.matches("input[type=checkbox],input[type=radio],select") &&
      tgt.closest("form[data-vibeos-command]") &&
      !tgt.dataset.vibeosCommand &&
      !tgt.dataset.vibeosAction
    )
      return;
    e.preventDefault();

    const ds = collectDataset(el);
    // A click that isn't a form submit may still be "submitting" an input the
    // AI rendered without a <form> (e.g. an "Add" button next to a text box).
    // Attach the surrounding fields so the agent sees what was typed.
    const scope = nearestFieldScope(el, root);
    const collected = scope ? collectFields(scope) : null;
    emit(el, {
      kind: "click",
      action: el.dataset.vibeosAction ?? ds.action ?? describe(el),
      // ALWAYS include a description (tag + label + text). Controls that share
      // one action but differ only by text — calculator digits all using
      // data-vibeos-action="calc-op", list rows, etc. — are otherwise
      // indistinguishable to the AI.
      sel: describe(el),
      value: collected?.primary || undefined,
      dataset: ds,
      formData: collected && Object.keys(collected.fields).length ? collected.fields : undefined,
    });
  };

  // Double-click (e.g. opening a file/folder in Files). AI is told to use
  // single clicks, but real-OS muscle memory makes users double-click — so
  // treat a double-click as an "open" intent too.
  const onDblClick = (e: MouseEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest("input,textarea,select,option,[contenteditable]")) return;
    const el = findInteractive(e.target, root);
    if (!el) return;
    if (
      el.dataset.vibeosLocal ||
      el.dataset.vibeosCommand ||
      (el.tagName === "SUMMARY" && !el.dataset.vibeosAction) ||
      el.closest("form[data-vibeos-command]")
    )
      return;
    e.preventDefault();
    const ds = collectDataset(el);
    emit(el, {
      kind: "click",
      action: el.dataset.vibeosAction ?? ds.action ?? describe(el),
      sel: describe(el),
      dataset: { ...ds, trigger: "dblclick", intent: "open" },
    });
  };

  const onSubmit = (e: SubmitEvent) => {
    // Always stop the native submit so the browser never navigates/reloads.
    e.preventDefault();
    e.stopPropagation();
    const form = e.target as HTMLFormElement;
    submitForm(
      form,
      e.submitter?.getAttribute("data-vibeos-action") ?? undefined,
      e.submitter ?? form,
    );
  };
  const preventSubmit = (e: Event) => e.preventDefault();

  const onChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    // Text input is captured on input, before app handlers run. A later native
    // blur/change can expose a script-modified value and is not new user text.
    if (target.matches("input,textarea,select") && !trustedInputOnly) drafts?.edit(target);
    const tag = target.tagName;
    if (
      target.closest("form[data-vibeos-command]") &&
      !target.dataset.vibeosCommand &&
      !target.dataset.vibeosAction
    )
      return;

    // Only "toggle-style" controls commit on change. Every free-text input
    // (text, search, number, email, tel, url, password, textarea, …) commits
    // on Enter / form submit instead — otherwise merely focusing then leaving
    // an input would fire a generation.
    const isToggleControl =
      tag === "SELECT" ||
      (tag === "INPUT" && /^(checkbox|radio|range|color|file)$/.test(target.type ?? ""));
    if (!isToggleControl) return;

    emit(target, {
      kind: "change",
      action: target.dataset.vibeosAction || fieldKey(target) || "change",
      dataset: collectDataset(target),
      value:
        target.type === "checkbox" || target.type === "radio"
          ? String(target.checked)
          : target.value,
    });
  };

  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLInputElement;
    if (
      target.matches('[role="tab"][data-vibeos-local]') &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
    ) {
      const tabs = [
        ...(target.closest('[role="tablist"]') ?? root).querySelectorAll<HTMLElement>(
          '[role="tab"][data-vibeos-local]:not([disabled]):not([aria-disabled="true"])',
        ),
      ];
      const index = tabs.indexOf(target);
      const next =
        tabs[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
        ];
      if (next) {
        e.preventDefault();
        next.focus();
        next.click();
      }
      return;
    }
    if (target.tagName !== "INPUT") return;
    // Enter on a free-text input = commit (forms handle their own submit).
    if (e.key !== "Enter" || target.form) return;
    e.preventDefault();
    emit(target, {
      kind: "key",
      action: target.dataset.vibeosAction || fieldKey(target) || "enter",
      dataset: collectDataset(target),
      value: target.value,
    });
  };

  // Drag SOURCE: make AI content draggable across apps. An element opts in with
  // data-vibeos-drag (+ optional data-drag-kind/-ref/-label); native <img>/<a>
  // work too. The DROP side lives on the window surface (AiHtmlSurface).
  const onDragStart = (e: DragEvent) => {
    const el = (e.target as HTMLElement)?.closest?.(
      "[data-vibeos-drag],img[src],a[href]",
    ) as HTMLElement | null;
    if (!el || !e.dataTransfer) return;
    const text = (el.textContent ?? "").trim().slice(0, 200);
    let payload: { kind: string; ref: string; label?: string } | null = null;
    if (el.matches("[data-vibeos-drag]")) {
      const kind = el.dataset.dragKind ?? "text";
      payload = {
        kind: ["text", "image", "file", "desktop-object", "app-shortcut"].includes(kind)
          ? kind
          : "text",
        ref: el.dataset.dragRef ?? text,
        label: el.dataset.dragLabel ?? text.slice(0, 80),
      };
    } else if (el.tagName === "IMG") {
      payload = {
        kind: "image",
        ref: (el as HTMLImageElement).src,
        label: (el as HTMLImageElement).alt || "image",
      };
    } else if (el.tagName === "A") {
      payload = {
        kind: "text",
        ref: (el as HTMLAnchorElement).href,
        label: text.slice(0, 80) || "link",
      };
    }
    if (!payload) return;
    e.dataTransfer.setData("application/x-vibeos-drag", JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", payload.label ?? payload.ref);
    e.dataTransfer.effectAllowed = "copy";
  };

  const onInput = (event: Event) => {
    const field = event.target as Field;
    if (field.matches("input,textarea,select")) {
      if (!trustedInputOnly || event.isTrusted) drafts?.edit(field);
      if (field.dataset.vibeosLocal)
        local?.(field, {
          kind: "input",
          value: field.value,
          dataset: collectDataset(field),
        });
    }
  };
  root.addEventListener("input", onInput, true);
  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", onDblClick);
  // Capture phase so the native submit is intercepted before the browser can
  // act on it — guarantees no full-page reload from an AI-generated <form>.
  root.addEventListener("submit", preventSubmit, true);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKey);
  root.addEventListener("dragstart", onDragStart);
  return () => {
    root.removeEventListener("input", onInput, true);
    root.removeEventListener("click", onClick);
    root.removeEventListener("dblclick", onDblClick);
    root.removeEventListener("submit", preventSubmit, true);
    root.removeEventListener("submit", onSubmit);
    root.removeEventListener("change", onChange);
    root.removeEventListener("keydown", onKey);
    root.removeEventListener("dragstart", onDragStart);
  };
}
