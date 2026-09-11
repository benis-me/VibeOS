# AGENTS.md

Guidance for AI coding agents working in **VibeOS** — an AI-hallucination-driven
operating system in the browser. Except for the core runtime, every window's UI
is generated in real time by AI via a pluggable provider (CodeBuddy / Claude Code
/ Codex / OpenRouter).

## Architecture (read this first)

The CLI-based providers (CodeBuddy, Claude Code, Codex) are driven **directly via
subprocess — no vendor SDKs** — so the AI layer is **backend-only — it cannot run
in the browser.** VibeOS is therefore:

```
packages/shared   protocol + domain types shared by both sides (@vibeos/shared)
apps/backend      Bun HTTP + WebSocket server: kernel/boot, provider manager, model
                  policy, prompt assembler, agent scheduler, syscall interpreter,
                  bun:sqlite repositories
apps/frontend     Vite + React 19 + Tailwind 4 + Zustand (custom token-based
                  design system + skins; NO component kit): desktop shell, window
                  manager, AI-HTML surface, context menus
```

- **SQLite is the source of truth for runtime state.** App packages, generated HTML, images and user files live in
  `~/.vibeos/disk`; frontend stores mirror backend state. File mutations and other
  user intents round-trip through the WebSocket; file downloads stream over HTTP.
- Transport: one WebSocket. Protocol is versioned envelopes with `c2s.*` /
  `s2c.*` message unions in `packages/shared/src/protocol`.
- **AI provider seam.** All model access goes through `ai/providers/` (`AiProvider`:
  `run()` + `discoverModels()`). `SdkManager.run()` resolves the role's model policy +
  localized system prompt, then delegates to the active provider — agents never touch a
  provider directly. CodeBuddy + Claude Code share `cli/AnthropicCliProvider` (both speak
  Anthropic stream-json via `<bin> -p --output-format stream-json`); Codex drives
  `codex exec --json`; OpenRouter is an HTTP provider (Vercel AI SDK). Active provider:
  Settings → env `VIBEOS_AI_PROVIDER` → `DEFAULT_PROVIDER` (claude); at boot, providers
  whose CLI isn't on PATH (`availableProviderIds()`) are skipped and the choice falls back
  to an available one (persisted). **UI generation is stateless** — each op is a fresh
  conversation (no session resume); the full current UI is sent as context every time
  (`[CURRENT UI]` in `PromptAssembler`, capped by `VIBEOS_SNAPSHOT_BUDGET`, 0 = no cap).
  Cost is taken from the Claude CLI's reported figure, else estimated from tokens
  (`ai/pricing.ts`) so codebuddy / codex / openrouter still show cost.
- **Skins.** Built-ins (`devdock` / `xp` / `aqua`) are immutable. The native **Skins**
  app creates blank custom skins (no built-in foundation), duplicates a selected
  skin's active appearance, and generates versions through `ai/skins.ts` and
  `SdkManager.run()`. Tasks belong to skins, not windows/sockets; boot marks unfinished
  requests interrupted. Only validated successful output creates and auto-activates
  an immutable version. Selecting an old version changes the next request's base.
  `packages/shared/src/domain/skins.ts` is the own token/target/property contract;
  never accept model-supplied selectors, arbitrary CSS or executable content. Optional
  chrome geometry and named image assets extend v1 compatibly. Color tokens cannot
  contain gradients in new output. Text generation includes a craft review; asset
  requests reuse `imageCache.ts` and await persistence before publishing. Only existing
  unchanged assets may reuse IDs. Preserve request ancestry and intent on refinements;
  generic app HTML image instructions must not be appended to skin JSON prompts.
  Titlebar/taskbar images use the dedicated inert material layer with low opacity;
  `font-title` connects window and taskbar names. `.vibeskin` packages contain the
  selected definition and raster image bytes. Imports validate all content before
  writes, remap IDs from image bytes, and create an independent editable skin.
  Definitions live at `disk/System/Skins/<id>/initial.json` and `Versions/<id>.json`;
  SQLite indexes versions, active selection and conversation/progress. The frontend
  applies scoped CSS live without regenerating app HTML. A copied built-in retains
  its immutable packaged chrome, with independent token/rule overrides. **App UI**
  agents are not told the skin: generated HTML stays token-based and skin-neutral.
- **Local applications and memory.** Applications is the native local app/version editor;
  see `docs/applications-and-memory.md`. Virtual apps have independent identities,
  immutable definitions in `Applications/*.vibeapp/Versions`, window-pinned versions,
  and revision-checked shared data in `System/AppData`. UI interactions remain AI generated.
  Definition tasks survive closing the editor; failed output never activates a version.
  Storage v3 preserves old snapshots in System/Sessions and archives legacy bundles.
  File moves/trash/restore reconcile application indexes in the existing file writer queue.
  System memory is opt-in, user-editable and separate from app data; direct user inputs
  are the only automatic extraction source. Manual edits/off invalidate in-flight extraction.
  Memory context enters through SdkManager; never feed model output or file contents into
  the extractor. Communication traces retain the initiating interaction ID so subsequent
  read/write turns can use full original form values instead of truncated summaries.
- **i18n (zh / en).** `Settings.locale` drives both the native UI (frontend dictionary in
  `lib/i18n.ts`, `useT()`) and generated content (`localeDirective()` appended to every
  system prompt in `SdkManager`). Undefined locale ⇒ frontend follows the browser and
  persists the choice on first boot. Localize new chrome strings via the dictionary —
  never hardcode user-facing text.

## Commands

```bash
bun install
bun run dev          # backend (:7720) + frontend (:7730), via scripts/dev.ts
bun run dev:backend  # backend only
bun run dev:frontend # frontend only
bun run build        # production frontend build
bun run typecheck    # typecheck all three packages
```

Offline / no-model mode: `VIBEOS_AI_STUB=1 bun run dev` (deterministic stub UI).
Useful env: `PORT`, `VIBEOS_DB_PATH`, `VIBEOS_AGENTS_DISABLED=1`, `VIBEOS_LOG_LEVEL=debug`.

### Sandbox caveat (important)

This environment injects a broken `NODE_OPTIONS` preload that crashes any
`node`-spawned tooling (tsc, vite, the CLI). Always strip it:

- Typecheck a package: `NODE_OPTIONS= node_modules/.bin/tsc -p <tsconfig> --noEmit`
- `scripts/dev.ts` and `apps/backend/src/ai/providers/cli/env.ts` (`cliEnv`) strip
  `NODE_OPTIONS` when it points at `$bunfs` — the node-based CLIs (claude/codebuddy)
  would otherwise crash on startup. The CLIs are spawned directly (their own shebang),
  not under bun.

## Core mechanics (don't break these)

- **AI render modes**: the OS decides a baseline before calling the AI
  (`PromptAssembler.decideRenderMode` → `force-full` | `prefer-incremental`),
  and the model declares `<vibeos-html mode="full|regions">`. Legacy unmarked
  output is still inferred from its region blocks (forced-full operations use
  the complete body). Region extraction stays depth-aware in `streamParser.ts`
  and `agents/regionMerge.ts` — do not simplify it to a single regex. Missing,
  duplicate, overlapping, or malformed region targets trigger one full repair;
  rejected output has no syscalls. Only first paint streams; existing windows
  apply a validated, persisted batch. `AiHtmlSurface` replaces target DOM nodes
  directly while the store retains a complete snapshot. Browser regression:
  run the command documented in `test/regions.browser.html`.
- **Per-window scheduling** (`agents/UiGenerationAgent.ts`): different windows
  run in parallel; within one window a new action **preempts** (aborts) the
  in-flight one ("latest wins"). Generation is stateless, so a preempt just
  aborts — there's no session to resume.
- **Event delegation** (`hooks/useDelegatedEvents.ts`): AI HTML never runs code.
  Clicks/submits/changes on `[data-vibeos-action]` become `c2s.op`. Clicks on
  editable inputs are passed through natively (never trigger generation). Forms
  are intercepted in the capture phase so they never reload the page. A click that
  isn't a form submit still collects nearby field values (the AI often omits a
  `<form>`), so submits carry what was typed. Operations include `regionPath`
  (the control's region followed by its ancestors) as model context.
- **Context menus** (`components/contextmenu/`): OS right-click. `openContextMenu`
  feeds a per-location menu (`menus.tsx`); panels are skin-styled via `.vibe-menu*`
  and submenus use a safety-triangle hover. Don't trigger native browser menus.
- **Syscalls** (`syscall/SyscallInterpreter.ts`): `app-state`, `notify`, `open`,
  `spawn-window`, `install`, `create-file`, `focus`, `close`.
  `communication` routes validated send/request/reply and event subscriptions through
  `events/communication.ts`; see `docs/communication.md`. App identity and causal
  traces come from the runtime. Keep FIFO message handling separate from interactive
  latest-wins generation, and propagate cancellation through read/write continuations.
  Generated HTML/notify/spawn responses declare one `app-state`: complete changed JSON
  or no data to keep state. Commit with the captured revision before other calls/UI.
  Read-only `app.data.changed` refreshes may omit it; an already-current view may
  return only a summary without triggering a full repair.
  Same-app peers refresh automatically with the initiating action and canonical data;
  explicit `app.data.changed` subscriptions override this default. Refreshes never
  repeat state writes; unchanged JSON creates no revision/event. Spawned windows retain
  opener, purpose and record context. `close` without an ID closes the current window;
  completing a task does not force closure. Old visible records initialize shared data
  on interaction without discarding other records or their stable IDs.
  Data deliveries bind literal text without model calls; never insert message data
  as HTML or run generated scripts. Declared subscriptions persist with validated
  snapshots; closing windows removes subscriptions and cancels related requests.
- **App instancing**: `AppManifest.singleInstance` → Settings is single-instance;
  Browser/Files/Terminal and virtual apps are multi-instance (new window each open).
- **Native Files**: `files/disk.ts` confines real file operations to the system disk.
  Files and desktop file opens dispatch through `filesHandlers.openDiskFile` to native
  text/media viewers. `windows.file_path` persists their file; Files mutations update
  that reference. Media previews use the shared passive MIME allowlist and Bun.file
  byte ranges; never serve HTML/SVG as active preview content.
  Native apps in `NATIVE_PRESET_APPS` never enter UI generation. Text writes require
  the read version to prevent overwriting concurrent edits; deletions go to `Trash`.
  Startup backs up legacy data before SQL changes, then `StorageRepo.migrateSystemDisk`
  upgrades storage once by version (including partially exported installations).
  Storage v2 materializes legacy desktop/recycled shortcuts as passive `.vibelink`
  app-ID references, preserving node IDs and icon positions. `VfsRepo.syncDesktopFiles`
  reconciles real Desktop files with runtime indexes; deleting a shortcut never
  uninstalls its app. Shortcut opens validate the file and target app before dispatch.
  Files navigation validates paths with `stat` before changing history; keyboard
  navigation belongs only to the focused window.
  AppRepo/AppMemoryRepo/ImagesRepo read and write disk content through runtime path
  indexes; old payload columns are cleared after migration, with the original DB in
  `runtime/backups`. Preserve snapshot commit guards when changing disk persistence.

## Hard product rules

- **NO EMOJI anywhere in generated UI/content.** App icons render via
  `components/AppIcon.tsx` as **Phosphor duotone** (built-in app icons are fixed in
  code, never from the DB); OS chrome uses **lucide**. Backend strips emoji from AI
  text (`stripEmoji` in `@vibeos/shared/util`); the frontend sanitizer strips it too.
  Prompts instruct the AI to use inline SVG, never emoji.
- Generated UI must be **vertically responsive** — fill the window, no empty gap
  at the bottom; the AI root uses `height:100%` + flex column.
- Visuals follow DevDock: neutral black/white/gray, oklch tokens, Geist +
  JetBrains Mono, thin borders, subtle shadows. Focused window = frosted glass.
  Skins (`devdock` / `xp` / `aqua`) layer over the same tokens via `data-skin`; new
  chrome should use `.vibe-*` hooks so a skin can restyle it.

## Conventions

- TypeScript everywhere, ESM, `.ts` extensions in imports (bun resolves them).
- Shared types live in `@vibeos/shared`; never duplicate protocol/domain types.
- All DB writes go through `db/repositories/*` and the single-writer
  `writeQueue` — never write to SQLite from elsewhere.
- After changes, run `bun run typecheck` (with the `NODE_OPTIONS=` prefix per
  package in this sandbox).
