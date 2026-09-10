export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export const fieldKey = (field: Field): string =>
  field.dataset.vibeosField ||
  field.name ||
  field.dataset.vibeosAction ||
  field.getAttribute("placeholder") ||
  field.getAttribute("aria-label") ||
  (field.id ? `#${field.id}` : "");
export const fieldValue = (field: Field): string =>
  /^(checkbox|radio)$/.test(field.type) ? String((field as HTMLInputElement).checked) : field.value;

type Draft = {
  value: string;
  type: string;
  submitted?: { id: string; value: string };
  edited: boolean;
};

function draftKey(field: Field) {
  const key = fieldKey(field);
  const surface = field.closest(".ai-surface");
  const peers = Array.from(surface?.querySelectorAll<Field>("input,textarea,select") ?? []).filter(
    (other) => fieldKey(other) === key,
  );
  if (peers.length <= 1) return key;
  const region = field.closest<HTMLElement>("[data-vibeos-region]")?.dataset.vibeosRegion;
  const form = field.form;
  const formIndex = form ? Array.from(surface?.querySelectorAll("form") ?? []).indexOf(form) : -1;
  return JSON.stringify([key, region, form?.id || formIndex, field.id || peers.indexOf(field)]);
}

/** The runtime owns drafts; generated markup cannot mark a field as user-edited. */
export function createDrafts() {
  const drafts = new Map<string, Draft>();
  return {
    edit(field: Field) {
      const key = draftKey(field);
      if (key && field.type !== "file")
        drafts.set(key, {
          value: fieldValue(field),
          type: field.type,
          edited: true,
          submitted: drafts.get(key)?.submitted,
        });
    },
    input(root: HTMLElement) {
      return Array.from(root.querySelectorAll<Field>("input,textarea,select")).flatMap((field) => {
        const key = fieldKey(field),
          draft = drafts.get(draftKey(field));
        return draft?.edited ? [{ key, type: field.type, value: fieldValue(field) }] : [];
      });
    },
    submit(id: string, fields: Record<string, string>, scope: HTMLElement) {
      for (const field of scope.querySelectorAll<Field>("input,textarea,select")) {
        if (!Object.hasOwn(fields, fieldKey(field))) continue;
        const draft = drafts.get(draftKey(field));
        const value = fieldValue(field);
        if (draft) {
          draft.submitted = { id, value };
          draft.edited = draft.value !== value;
        }
      }
    },
    restore(root: HTMLElement, operationId?: string) {
      for (const field of root.querySelectorAll<Field>("input,textarea,select")) {
        const key = draftKey(field),
          draft = drafts.get(key);
        if (!draft || draft.type !== field.type) continue;
        if (
          operationId &&
          draft.submitted?.id === operationId &&
          draft.submitted.value === draft.value
        ) {
          drafts.delete(key);
          if (field instanceof HTMLInputElement && /^(checkbox|radio)$/.test(field.type))
            field.checked = field.defaultChecked;
          else if (field instanceof HTMLSelectElement)
            field.value =
              Array.from(field.options).find((option) => option.defaultSelected)?.value ??
              field.options[0]?.value ??
              "";
          else field.value = field.defaultValue;
          continue;
        }
        if (/^(checkbox|radio)$/.test(field.type))
          (field as HTMLInputElement).checked = draft.value === "true";
        else field.value = draft.value;
      }
    },
    clear() {
      drafts.clear();
    },
  };
}
