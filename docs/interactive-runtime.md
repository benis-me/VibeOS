# Interactive application versions

VibeOS still generates application behavior with AI. A small prepared UI layer makes likely navigation immediate; optional isolated JavaScript handles continuous presentation such as clocks, Canvas and animation. Semantic actions continue through the existing AI agent and real system services.

In **Applications**, select **Next version → Interactive** and describe the change. Successful generation creates and activates a new immutable version. Existing windows retain their pinned version; **Open with new version** opens another window alongside them. Classic versions support prepared controls and CSS, but never execute generated scripts. Existing installations default to Classic. Selecting an old version rolls back future launches without changing open windows or shared data.

Preparation happens in the same generation, with a few useful tabs/details rather than speculative background model calls. Prepared controls never execute system calls or mutate shared application data.

## Prepared controls

```html
<button type="button" data-vibeos-local='{"action":"toggle","target":"details"}'>Details</button>
<aside data-vibeos-local-id="details" hidden>Prepared view</aside>
```

| Action | Target contract |
| --- | --- |
| `show`, `hide`, `toggle` | `data-vibeos-local-id="target"` |
| `select` | Panels with `data-vibeos-group="target" data-vibeos-panel="value"`; controls specify `value` |
| `filter` | Search input; target's direct children carry `data-vibeos-item`, optionally `data-vibeos-search` |
| `sort` | Target's direct children carry `data-vibeos-item`, optionally `data-vibeos-sort`; `direction` is `asc` or `desc` |

Targets use stable identifiers (letter followed by letters, digits, `_` or `-`, at most 80 characters). Use native buttons and labelled inputs; tab controls use `role="tab"` inside `role="tablist"` and support arrow keys, Home and End.

The runtime updates `aria-selected` on select controls. Style `[aria-selected="true"]` rather than a fixed active class, so the highlight follows local navigation and restored state.

Controls revealing prepared **record data** must also declare `data-vibeos-prefetch="true"` and an AI fallback such as `data-vibeos-action="view-task" data-id="task-1"`. The host compares the snapshot's committed data revision against the latest app-data delivery. Stale or busy views return to AI. Pure tabs/menus need no prefetch marker. Missing or invalid local targets also fall back to AI.

The selected panel, filter and sort are window view state, separate from shared app data. They survive full/region updates and session restoration and are supplied to the next AI turn. View state is limited to 16 KiB of JSON. It is not a place for business records.

Native `details` / `summary` expands locally too. Give `details` a stable `data-vibeos-local-id` to retain its open state. Record summaries use the same prefetch marker and AI fallback; an explicit AI action without that marker remains an AI operation.

## CSS and JavaScript

Both modes accept small scoped `<style>` blocks, transitions and keyframes. The sanitizer scopes selectors, namespaces animations and removes global CSS declarations. Motion obeys reduced-motion preferences. Interactive frames receive the real fonts and current skin tokens; changing skins does not regenerate an app.

Interactive versions may contain at most eight inert script blocks totalling 64 KiB:

```html
<section data-vibeos-region="clock">
  <output data-clock></output>
  <script type="application/vibeos" data-vibeos-script="clock">
    const deadline = vibe.state().deadline || Date.now() + 60000;
    vibe.setState({ deadline });
    const paint = () => {
      root.querySelector('[data-clock]').textContent =
        String(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    paint();
    vibe.interval(paint, 250);
  </script>
</section>
```

Each block is a function body receiving `vibe` and `root`, where `root` is its closest region (or the surface). Scripts have independent function scopes. Use async handlers for asynchronous work. Top-level code should initialize presentation, not write real data.

| API | Behavior |
| --- | --- |
| `vibe.state()` | A copy of current window view state |
| `vibe.setState(patch)` | Merge and persist serializable view fields |
| `vibe.on(event, selector, handler)` | Delegated local handler; consumes the event so it does not also trigger AI |
| `vibe.interval`, `vibe.timeout`, `vibe.frame` | Tracked resources, paused while minimized/hidden and cleaned on replacement; frame is one-shot |
| `vibe.onUpdate(handler)` | Reconcile after a DOM patch |
| `vibe.onData(handler)` | Receive actual data-mode deliveries, including `appData` |
| `vibe.act(action, data?)` | Ask the existing AI agent to handle an action, with actual fields and view state |
| `vibe.command(command)` | Promise of an actual result through the existing communication protocol |
| `vibe.signal` | Abort signal for manually registered resources |
| Returned function | Optional cleanup when the script's owning region is replaced or closed |

Put scripts in the smallest region they own. Unaffected regions keep running during AI patches. Replaced scripts clean up before mounting their replacements; state and drafts survive. Timer deadlines should use `Date.now()`, not tick counts. Resources created directly with browser APIs must be cleaned explicitly or tied to `vibe.signal`.

For a semantic action, an ordinary `data-vibeos-action` button is usually sufficient. Use `vibe.command` only when a direct deterministic operation helps; it reuses the same real file/app-data/communication services, including revision conflicts, actual replies and cancellation. No script gets backend credentials, a database connection or another window's identity.

## Isolation and recovery

Each interactive window runs in an opaque-origin iframe with scripts and native form events enabled. It has no same-origin privilege, popups, top navigation, modal dialogs, workers or direct fetch/WebSocket access. Form navigation is prevented and blocked by CSP. Two intersecting script policies allow the packaged runtime and nonce-authorized inline mounts, preventing reuse of a nonce for arbitrary remote script URLs. Parent/child communication uses a validated MessageChannel; the parent supplies the source window identity.

This follows the browser's [iframe sandbox model](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox). It isolates the host DOM/storage, not CPU or memory at the operating-system process level. Generated code can still be inefficient or incorrect. Use tracked APIs, keep scripts small, and use AI for semantics.

Streaming previews never mount scripts. Script syntax and declarations are validated before a generated version/UI is committed and before its syscalls execute. Runtime errors appear inside the application with **Repair with AI** and **Reload**; reloading retains window view state. Failed generation preserves the previous version. Validation failures and their precise causes appear in Activity Monitor.

## Storage and compatibility

- `definition.runtime` is `html` or `interactive`; absent means `html`.
- Each `app_versions` entry stores its runtime; each window resolves its pinned version.
- Window view state lives in `windows.view_state_json`; snapshot data revisions live in `app_memory.data_version`.
- Installed definitions and inert scripts remain in the existing version directory on the system disk. There is no second app datastore.
- Interactive exports use `.vibeapp` format 3. Classic exports remain format 2 without a runtime field. Import validates before writes, and duplication preserves the mode.
- Authoring prefers a small `vibeos-application` JSON code fence followed by raw `<vibeos-html mode="full">`; this avoids JSON-escaping HTML/CSS/JS. Legacy all-JSON model output remains accepted.
- `/api/app-runtime.js` is built from local sources by Bun, once per backend process. Restart the backend after editing the runtime bundle's source during development.

## Regression checks

```sh
NODE_OPTIONS= bun test apps/backend/src/agents/appWorkflow.test.ts
```

For browser checks, start a backend with an **isolated** `VIBEOS_DATA_DIR`/`VIBEOS_DB_PATH` on `PORT=17720`, then a repo-root Vite server:

```sh
NODE_OPTIONS= PORT=17720 bun node_modules/vite/bin/vite.js --config apps/frontend/vite.config.ts --port 17732
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome NODE_OPTIONS= node test/interactive-runtime.browser.mjs
```

The browser check uses the actual surface and runtime bundle with a deterministic transport, without model calls or personal data. It covers preparation, stale fallback, script/region lifecycle, input/state preservation, isolation, system response handling, motion, skin updates, minimization, recovery and classic compatibility. Real-provider acceptance is separate.
