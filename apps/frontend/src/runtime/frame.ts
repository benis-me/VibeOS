import {
  communicationCommandSchema,
  viewStateSchema,
  RUNTIME_SCRIPT_TYPE,
  MAX_RUNTIME_SCRIPT,
  type ViewState,
  type AppDelivery,
  type MessageData,
} from "@vibeos/shared";
import type { AiOp, UiPatchPayload } from "@vibeos/shared/protocol";
import { installDelegatedEvents } from "../hooks/useDelegatedEvents";
import { sanitizeAiHtml } from "../lib/sanitize";
import { replaceRegions } from "../lib/patch";
import { bindCommunication } from "../lib/bindCommunication";
import { createDrafts, fieldKey, type Field } from "../lib/fields";
import { installImageRetries } from "../lib/imageRetry";
import { runPrepared, restorePrepared } from "../lib/preparedInteractions";

// This bundle has no WebSocket, credentials, host stores or network client.
const root = document.getElementById("surface")!;
const theme = document.getElementById("theme")!;
const nonce =
  document.currentScript?.nonce ??
  document.querySelector("script[nonce]")?.getAttribute("nonce") ??
  "";
let port: MessagePort | undefined;
let send: (data: unknown) => void = () => {};
let state: ViewState = {};
let dataVersion: string | undefined;
let currentDataVersion: string | undefined;
let visible = true;
let windowId = "";
let busy = false;
let sequence = 0;
const drafts = createDrafts();
const stopImageRetries = installImageRetries(root);
const deliveries = new Map<string, AppDelivery>();
const pending = new Map<
  string,
  {
    resolve: (value: MessageData) => void;
    reject: (e: Error) => void;
    cleanup: () => void;
  }
>();
type Scope = {
  node: HTMLElement;
  source: string;
  abort: AbortController;
  cleanups: Set<() => void>;
  updates: Set<() => void>;
  data: Set<(delivery: AppDelivery) => void>;
  resumed: Set<() => void>;
};
const scopes = new Map<string, Scope>();
const report = (error: unknown) =>
  send({
    type: "error",
    message: String(error instanceof Error ? error.message : error).slice(0, 1000),
  });
const safe = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    report(error);
  }
};
function setState(next: ViewState) {
  state = viewStateSchema.parse(next);
  restorePrepared(root, state);
  send({ type: "view", state });
}
function act(op: AiOp, scope = root) {
  const formData = {
    ...Object.fromEntries(
      [...scope.querySelectorAll<Field>("input,textarea,select")]
        .filter((f) => f.type !== "file" && f.type !== "password")
        .map((f) => [
          fieldKey(f),
          /^(checkbox|radio)$/.test(f.type) ? String((f as HTMLInputElement).checked) : f.value,
        ]),
    ),
    ...op.formData,
  };
  const next = {
    ...op,
    id: op.id ?? `runtime-${Date.now()}-${sequence++}`,
    formData,
    userInput: op.userInput ?? drafts.input(scope),
    viewState: state,
  };
  drafts.submit(next.id, formData, scope);
  send({ type: "op", op: next });
}
function command(value: unknown, scope?: Scope): Promise<MessageData> {
  if (scope?.abort.signal.aborted) return Promise.reject(new Error("communication.interrupted"));
  const parsed = communicationCommandSchema.safeParse(value);
  if (!parsed.success || pending.size >= 64)
    return Promise.reject(new Error("communication.invalid"));
  const id = `runtime-${sequence++}`;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      pending.delete(id);
      reject(new Error("communication.interrupted"));
    };
    const cleanup = () => scope?.abort.signal.removeEventListener("abort", cancel);
    pending.set(id, { resolve, reject, cleanup });
    scope?.abort.signal.addEventListener("abort", cancel, { once: true });
    send({ type: "command", id, command: parsed.data });
  });
}
function stop(id: string) {
  const scope = scopes.get(id);
  if (!scope) return;
  scopes.delete(id);
  scope.abort.abort();
  for (const cleanup of [...scope.cleanups].reverse()) safe(cleanup);
}
function api(scope: Scope) {
  const alive = () => !scope.abort.signal.aborted;
  const run = (fn: () => void) => {
    if (alive()) safe(fn);
  };
  return Object.freeze({
    signal: scope.abort.signal,
    state: () => structuredClone(state),
    setState: (patch: ViewState) => {
      if (alive()) setState({ ...state, ...viewStateSchema.parse(patch) });
    },
    act: (action: string, data?: MessageData) => {
      if (alive())
        act(
          {
            kind: "custom",
            action,
            value: data === undefined ? undefined : JSON.stringify(data),
          },
          scope.node,
        );
    },
    command: (input: unknown) => command(input, scope),
    on: (event: string, selector: string, handler: (e: Event, target: Element) => void) => {
      scope.node.addEventListener(
        event,
        (e) => {
          const target = e.target instanceof Element ? e.target.closest(selector) : null;
          if (!target || !scope.node.contains(target)) return;
          e.preventDefault();
          e.stopPropagation();
          run(() => handler(e, target));
        },
        { signal: scope.abort.signal, capture: true },
      );
    },
    interval: (fn: () => void, ms: number) => {
      const id = window.setInterval(
        () => {
          if (visible) run(fn);
        },
        Math.max(16, ms),
      );
      scope.cleanups.add(() => clearInterval(id));
      return id;
    },
    timeout: (fn: () => void, ms: number) => {
      const cleanup = () => {
        clearTimeout(id);
        scope.resumed.delete(callback);
      };
      const callback = () => {
        scope.resumed.delete(callback);
        scope.cleanups.delete(cleanup);
        run(fn);
      };
      const id = window.setTimeout(
        () => (visible ? callback() : scope.resumed.add(callback)),
        Math.max(0, ms),
      );
      scope.cleanups.add(cleanup);
      return id;
    },
    frame: (fn: (time: number) => void) => {
      let id = 0;
      const cleanup = () => {
        cancelAnimationFrame(id);
        scope.resumed.delete(callback);
      };
      const callback = () => {
        scope.resumed.delete(callback);
        id = requestAnimationFrame((time) => {
          if (!visible) {
            scope.resumed.add(callback);
            return;
          }
          scope.cleanups.delete(cleanup);
          run(() => fn(time));
        });
      };
      scope.cleanups.add(cleanup);
      if (visible) callback();
      else scope.resumed.add(callback);
      return id;
    },
    onUpdate: (fn: () => void) => {
      scope.updates.add(fn);
    },
    onData: (fn: (delivery: AppDelivery) => void) => {
      scope.data.add(fn);
      for (const delivery of deliveries.values()) run(() => fn(structuredClone(delivery)));
    },
  });
}
// Only the nonce-authorized inert-script loader calls this after validated HTML commits.
Object.defineProperty(window, "__vibeosMount", {
  value: (id: string, factory: (vibe: ReturnType<typeof api>, node: HTMLElement) => unknown) => {
    const scope = scopes.get(id);
    if (!scope) return;
    const cleanup = factory(api(scope), scope.node);
    if (typeof cleanup === "function") scope.cleanups.add(cleanup as () => void);
  },
});

function render(html: string, patch?: UiPatchPayload) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const scripts = new Map<string, string>();
  let bytes = 0;
  for (const el of template.content.querySelectorAll("script")) {
    const id = el.getAttribute("data-vibeos-script") ?? "";
    const source = el.textContent ?? "";
    if (
      el.getAttribute("type") !== RUNTIME_SCRIPT_TYPE ||
      el.hasAttribute("src") ||
      !/^[a-zA-Z][\w-]{0,79}$/.test(id) ||
      scripts.has(id) ||
      scripts.size >= 8 ||
      (bytes += new TextEncoder().encode(source).length) > MAX_RUNTIME_SCRIPT
    ) {
      el.remove();
      continue;
    }
    scripts.set(id, source);
    const marker = document.createElement("template");
    marker.setAttribute("data-vibeos-script-id", id);
    el.replaceWith(marker);
  }
  const clean = sanitizeAiHtml(template.innerHTML, windowId);
  const next = document.createElement("div");
  next.innerHTML = clean;
  const targets =
    patch?.mode === "regions"
      ? (patch.regions ?? []).flatMap((r) => [
          ...root.querySelectorAll(`[data-vibeos-region="${CSS.escape(r.region)}"]`),
        ])
      : [root];
  for (const [id, scope] of scopes)
    if (scope.source !== scripts.get(id) || targets.some((target) => target.contains(scope.node)))
      stop(id);
  const active = document.activeElement as Field | null;
  const focus = active?.matches("input,textarea,select")
    ? {
        key: fieldKey(active),
        start: (active as HTMLInputElement).selectionStart,
        end: (active as HTMLInputElement).selectionEnd,
      }
    : undefined;
  const scroll = root.scrollTop;
  if (patch?.mode === "regions") {
    try {
      replaceRegions(
        root,
        (patch.regions ?? []).map(({ region }) => {
          const target = next.querySelector(`[data-vibeos-region="${CSS.escape(region)}"]`);
          if (!target) throw new Error("Missing region");
          return { region, html: target.outerHTML };
        }),
      );
    } catch {
      for (const id of scopes.keys()) stop(id);
      root.innerHTML = clean;
    }
  } else root.innerHTML = clean;
  root.scrollTop = scroll;
  drafts.restore(root, patch?.done ? patch.operationId : undefined);
  restorePrepared(root, state);
  for (const delivery of deliveries.values()) bindCommunication(root, delivery, (s) => s);
  if (focus && !active?.isConnected)
    for (const field of root.querySelectorAll<Field>("input,textarea,select"))
      if (fieldKey(field) === focus.key) {
        field.focus({ preventScroll: true });
        try {
          (field as HTMLInputElement).setSelectionRange(focus.start, focus.end);
        } catch {
          /* selects/numeric fields */
        }
        break;
      }
  if (
    patch &&
    !patch.streaming &&
    (patch.dataVersion !== undefined || patch.mode === "full" || patch.regions?.length)
  )
    dataVersion = patch.dataVersion;
  if (!patch?.streaming)
    for (const [id, source] of scripts) {
      if (scopes.has(id)) continue;
      const marker = root.querySelector(`[data-vibeos-script-id="${CSS.escape(id)}"]`);
      const node = marker?.closest<HTMLElement>("[data-vibeos-region]") ?? root;
      if (!marker) continue;
      const scope: Scope = {
        node,
        source,
        abort: new AbortController(),
        cleanups: new Set(),
        updates: new Set(),
        data: new Set(),
        resumed: new Set(),
      };
      scopes.set(id, scope);
      const script = document.createElement("script");
      script.nonce = nonce;
      script.textContent = `window.__vibeosMount(${JSON.stringify(id)}, function(vibe, root) {\n${source}\n});`;
      document.head.appendChild(script);
      script.remove();
    }
  for (const scope of scopes.values()) for (const update of scope.updates) safe(update);
}

installDelegatedEvents(
  root,
  (op, scope) => {
    if (op.dataset?.vibeosCommand) {
      try {
        const value = JSON.parse(op.dataset.vibeosCommand);
        if (op.formData) value.data = { ...value.data, ...op.formData };
        void command(value).catch(report);
      } catch (error) {
        report(error);
      }
    } else act(op, scope);
  },
  drafts,
  (el, op) => {
    const next = runPrepared(
      root,
      el,
      op.value,
      state,
      !busy && !!dataVersion && dataVersion === currentDataVersion,
    );
    if (!next) return false;
    setState(next);
    return true;
  },
  true,
);
document.addEventListener("pointerdown", () => send({ type: "focus" }), true);
document.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
    send({ type: "context", x: e.clientX, y: e.clientY });
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    if ((e.metaKey || e.ctrlKey) && ["k", " "].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      send({
        type: "shortcut",
        key: e.key.toLowerCase(),
        ctrl: e.ctrlKey,
        meta: e.metaKey,
      });
    }
  },
  true,
);
root.addEventListener("dragover", (e) => e.preventDefault());
root.addEventListener("drop", (e) => {
  e.preventDefault();
  const raw = e.dataTransfer?.getData("application/x-vibeos-drag");
  try {
    const text = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain");
    const source = raw
      ? JSON.parse(raw)
      : text
        ? { kind: "text", ref: text, label: text.slice(0, 80) }
        : e.dataTransfer?.files[0]
          ? { kind: "file", ref: e.dataTransfer.files[0].name }
          : null;
    if (source) send({ type: "drop", source });
  } catch (error) {
    report(error);
  }
});
window.addEventListener("error", (e) => report(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  report(e.reason);
});
window.addEventListener("message", function initialize(event) {
  if (event.source !== parent || event.data?.type !== "vibeos.connect" || port || !event.ports[0])
    return;
  port = event.ports[0];
  send = port.postMessage.bind(port);
  state = viewStateSchema.parse(event.data.state ?? {});
  dataVersion = event.data.dataVersion;
  windowId = String(event.data.windowId);
  root.dataset.aiWindow = windowId;
  port.onmessage = ({ data }) =>
    safe(() => {
      if (data.type === "render") render(data.html, data.patch);
      if (data.type === "theme") {
        theme.textContent = data.css;
        document.documentElement.className = data.className;
        for (const key of Object.keys(document.documentElement.dataset))
          delete document.documentElement.dataset[key];
        for (const [key, value] of Object.entries(data.dataset))
          document.documentElement.dataset[key] = String(value);
      }
      if (data.type === "status") {
        visible = data.visible;
        busy = data.busy;
        root.toggleAttribute("data-runtime-paused", !visible);
        if (visible)
          for (const scope of scopes.values()) for (const fn of [...scope.resumed]) safe(fn);
      }
      if (data.type === "delivery") {
        const delivery = data.delivery as AppDelivery;
        if (delivery.channel) {
          deliveries.delete(delivery.channel);
          deliveries.set(delivery.channel, delivery);
          if (deliveries.size > 32) deliveries.delete(deliveries.keys().next().value!);
        }
        if (
          delivery.channel === "appData" &&
          delivery.data &&
          typeof delivery.data === "object" &&
          !Array.isArray(delivery.data)
        )
          currentDataVersion = String(delivery.data.version);
        bindCommunication(root, delivery, (key) => data.errorText ?? key);
        for (const scope of scopes.values())
          for (const fn of scope.data) safe(() => fn(structuredClone(delivery)));
      }
      if (data.type === "result") {
        const request = pending.get(data.id);
        pending.delete(data.id);
        request?.cleanup();
        if (data.error) request?.reject(new Error(data.error));
        else request?.resolve(data.value);
      }
      if (data.type === "dispose") {
        stopImageRetries();
        for (const id of scopes.keys()) stop(id);
        for (const req of pending.values()) {
          req.cleanup();
          req.reject(new Error("communication.closed"));
        }
        pending.clear();
        port?.close();
      }
    });
  port.start();
});
parent.postMessage({ type: "vibeos.ready" }, "*");
