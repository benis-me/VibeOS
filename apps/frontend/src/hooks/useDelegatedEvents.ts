import { useEffect, type RefObject } from "react";
import type { AiOp } from "@vibeos/shared/protocol";

function collectDataset(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
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
function collectFields(scope: HTMLElement): { fields: Record<string, string>; primary: string } {
  const fields: Record<string, string> = {};
  let primary = "";
  const els = scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select",
  );
  for (const f of els) {
    const type = ((f as HTMLInputElement).type || "text").toLowerCase();
    if (/^(button|submit|reset|image|file)$/.test(type)) continue;
    const val =
      type === "checkbox" || type === "radio" ? String((f as HTMLInputElement).checked) : f.value;
    if (!val) continue;
    const key =
      f.getAttribute("name") ||
      (f as HTMLElement).dataset.vibeosAction ||
      f.getAttribute("placeholder") ||
      f.getAttribute("aria-label") ||
      (f.id ? `#${f.id}` : "");
    if (key && fields[key] === undefined) fields[key] = val.slice(0, 2000);
    if (!primary && (f.tagName === "TEXTAREA" || /^(text|search|email|tel|url|number|password|)$/.test(type))) {
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
  const FIELD = "input:not([type='button']):not([type='submit']):not([type='reset']), textarea, select";
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
  "[data-vibeos-action],a,button,[role='button'],[role='link'],[role='menuitem'],[role='tab'],[role='option'],summary,label[for],li[data-id],li[onclick],.clickable,[data-clickable]";

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
  onOp: (op: AiOp) => void,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const submitForm = (form: HTMLFormElement, action?: string) => {
      const fd: Record<string, string> = {};
      // 1) named fields via FormData
      new FormData(form).forEach((v, k) => {
        if (typeof v === "string") fd[k] = v;
      });
      // 2) belt-and-suspenders: collect EVERY input/textarea/select value, even
      // unnamed ones, keyed by name → action → placeholder. AI often omits name.
      const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      );
      let primary = "";
      for (const f of fields) {
        const key = f.getAttribute("name") || f.dataset.vibeosAction || f.getAttribute("placeholder") || "";
        if (key && fd[key] === undefined) fd[key] = f.value;
        // remember the first non-empty text value as the "primary" input
        if (!primary && f.value && /^(INPUT|TEXTAREA)$/.test(f.tagName)) primary = f.value;
      }
      onOp({
        kind: "submit",
        action: action ?? form.dataset.vibeosAction ?? "submit",
        // surface the main value explicitly so the AI can't miss it
        value: primary,
        dataset: collectDataset(form),
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

      // Otherwise, the nearest element carrying an explicit action wins.
      const actionEl = tgt.closest<HTMLElement>("[data-vibeos-action]");
      const el = actionEl ?? findInteractive(e.target, root);
      if (!el) return;
      e.preventDefault();

      // A real submit button inside a form → submit so typed values are sent.
      const btn = el as HTMLButtonElement;
      const form = btn.form ?? el.closest("form");
      const isSubmit =
        btn.type === "submit" ||
        ((btn.tagName === "BUTTON" || (btn as HTMLInputElement).type === "submit") && !btn.type);
      if (form && isSubmit) {
        submitForm(form, el.dataset.vibeosAction);
        return;
      }

      const ds = collectDataset(el);
      // A click that isn't a form submit may still be "submitting" an input the
      // AI rendered without a <form> (e.g. an "Add" button next to a text box).
      // Attach the surrounding fields so the agent sees what was typed.
      const scope = nearestFieldScope(el, root);
      const collected = scope ? collectFields(scope) : null;
      onOp({
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
      e.preventDefault();
      const ds = collectDataset(el);
      onOp({
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
      submitForm(e.target as HTMLFormElement);
    };

    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const tag = target.tagName;

      // Only "toggle-style" controls commit on change. Every free-text input
      // (text, search, number, email, tel, url, password, textarea, …) commits
      // on Enter / form submit instead — otherwise merely focusing then leaving
      // an input would fire a generation.
      const isToggleControl =
        tag === "SELECT" ||
        (tag === "INPUT" &&
          /^(checkbox|radio|range|color|file)$/.test(target.type ?? ""));
      if (!isToggleControl) return;

      onOp({
        kind: "change",
        action: target.dataset.vibeosAction ?? target.name ?? "change",
        dataset: collectDataset(target),
        value:
          target.type === "checkbox" || target.type === "radio"
            ? String(target.checked)
            : target.value,
      });
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLInputElement;
      if (target.tagName !== "INPUT") return;
      // Enter on a free-text input = commit (forms handle their own submit).
      if (e.key !== "Enter" || target.form) return;
      e.preventDefault();
      onOp({
        kind: "key",
        action: target.dataset.vibeosAction ?? target.name ?? "enter",
        dataset: collectDataset(target),
        value: target.value,
      });
    };

    root.addEventListener("click", onClick);
    root.addEventListener("dblclick", onDblClick);
    // Capture phase so the native submit is intercepted before the browser can
    // act on it — guarantees no full-page reload from an AI-generated <form>.
    root.addEventListener("submit", onSubmit, true);
    root.addEventListener("change", onChange);
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("dblclick", onDblClick);
      root.removeEventListener("submit", onSubmit, true);
      root.removeEventListener("change", onChange);
      root.removeEventListener("keydown", onKey);
    };
  }, [ref, onOp]);
}
