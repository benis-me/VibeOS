# VibeOS

**English** · [简体中文](./README_CN.md)

An **AI-hallucination-driven operating system** in the browser. Except for the
core runtime, every window's interface is generated in real time by AI: the user
acts on a window, and the system asks the model what the window should become
next — as if it were a real program responding.

![VibeOS — an AI-hallucination-driven OS in the browser](docs/screenshot.jpeg)

> **A reproduction of the Microsoft Build 2026 "Vibe OS" demo.**
> VibeOS is a from-scratch fan reproduction of the concept shown in the
> **Microsoft Build 2026 Vibe OS** demo. Full credit and many thanks to that demo
> for the inspiration — this project exists because of it.

> The OS is real (kernel, windows, persistence, agents, context menus). The
> *contents* are hallucinated.

## Features

- **AI dynamic UI** — app windows are HTML fragments generated/patched live by the
  model. UI generation is **stateless**: every action sends the full current UI as
  context, so any app re-renders correctly without relying on a growing chat session.
- **Skins / theme system** — switch the whole OS look live in Settings: **DevDock**
  (the native minimal theme), **Windows XP "Luna"**, and **Mac OS X "Aqua"**. Skins
  are pure CSS over design tokens, so the OS chrome *and* the AI-generated content
  both re-skin instantly — independent of light/dark.
- **OS context menus** — right-click anywhere. Menus differ by location (desktop,
  window title bar, app content, taskbar, taskbar item), submenus follow the
  "safety triangle" aim, and the styling follows the active skin.
- **Activity Monitor** — a live dashboard of every AI run: token-usage chart
  (input vs output), by-model distribution, cost, latency, error rate, and a
  scroll-paginated run log.
- **App Store & freezing** — install template apps, **freeze** a window's current
  state into a reusable app, and export / import apps as `.vibeapp` JSON.
- **Persistent system state** — windows, app memory, virtual filesystem, settings,
  notifications, the user profile and agent runs live in SQLite and survive restarts.
- **Multi-agent runtime** — several agents drive the system concurrently:
  - **UI-Generation Agent** (strong model) — renders/patches windows on user actions.
  - **System-Event Agent** (fast model, on a timer) — invents ambient notifications so
    the OS feels alive, without being user-triggered.
  - **Maintenance Agent** (fastest model) — consolidates per-window memory, prunes logs.
- **Desktop shell** — desktop, draggable/resizable multi-window manager, taskbar,
  start menu (split into *system* and *generated* apps), notifications (toasts + center).
- **Global user profile** — a profile/memory the user writes once; every generated app
  reads it so the OS feels personalized and coherent across windows.
- **System calls** — the model can emit `notify`, `open`, `spawn-window`, `install`
  (virtual app + desktop shortcut), `create-file`, `focus` and `close` calls.
- **Sandboxed rendering** — AI HTML is sanitized (no scripts / inline handlers); all
  interaction is captured by event delegation and routed back as operations — including
  the values typed into inputs, so submits carry their content.
- **Pluggable AI backends** — the model layer sits behind one `AiProvider` seam, so the
  OS runs on **CodeBuddy**, **Claude Code**, or **Codex** (local CLIs) or **OpenRouter**
  / any OpenAI-compatible API (via the Vercel AI SDK). Switchable live in Settings.
- **Bilingual (zh / en)** — all native UI *and* AI-generated content follow the chosen
  language; the locale is injected into every generation prompt.

## Tech stack

Bun (runtime + package manager) · Vite 8 · React 19 · Tailwind CSS 4 · Zustand ·
`bun:sqlite` · [`motion`](https://motion.dev) · Phosphor (app icons) + lucide (chrome).

The UI is built on a **custom, token-based design system** (oklch CSS variables,
Geist + JetBrains Mono). The skin system layers alternate visual languages
(XP / Aqua) over those same tokens via `data-skin` on `<html>`.

AI backends use **no vendor SDKs for the CLIs**: `claude` / `codebuddy` are driven in
headless stream-json mode (`-p --output-format stream-json`) and `codex` via
`codex exec --json`. **OpenRouter** (and any OpenAI-compatible API) goes through
[`ai`](https://www.npmjs.com/package/ai) + `@ai-sdk/openai-compatible`.

## Architecture

The CLI-based providers (CodeBuddy / Claude Code / Codex) each spawn a CLI subprocess,
so the AI layer runs **backend-only**. VibeOS is therefore a Bun backend (HTTP +
WebSocket) that drives the providers and the agent scheduler, plus a Vite/React frontend
that connects over one WebSocket. SQLite is the single source of truth; the frontend
Zustand stores mirror it.

All model access funnels through a single `AiProvider` seam (`apps/backend/src/ai/providers/`),
so agents, the prompt assembler, and the frontend never know which backend is active. CLI
providers stream over `providers/cli/` (subprocess + JSONL); OpenRouter is an HTTP provider.

```
packages/shared   protocol + domain types shared by both sides
apps/backend      Bun server: kernel/boot, SDK manager, model policy, prompt
                  assembler, agent scheduler, syscall interpreter, sqlite repos
apps/frontend     React desktop shell: window manager, taskbar, start menu,
                  AI-HTML surface, context menus, skins, notifications, settings
```

## Getting started

Requires **Bun**. For real AI, the active provider's backend must be reachable: the
matching CLI on PATH and authenticated (`codebuddy` / `claude` / `codex`), or an
`OPENROUTER_API_KEY` for `openrouter`.

```bash
bun install
bun run dev        # starts backend (:7720) + frontend (:7730)
```

Open http://localhost:7730.

### Offline / stub mode

To run the whole OS without the model (deterministic stub UI):

```bash
VIBEOS_AI_STUB=1 bun run dev
```

### Environment

Copy `.env.example`. Notable variables:

| Variable | Purpose |
|---|---|
| `PORT` | backend port (default 7720) |
| `VIBEOS_DB_PATH` | SQLite file (default `./data/vibeos.db`) |
| `VIBEOS_AI_PROVIDER` | boot default backend: `claude` (default) `codex` `codebuddy` `openrouter`; unavailable CLIs are skipped |
| `OPENROUTER_API_KEY` | API key for the `openrouter` provider (or `VIBEOS_AI_API_KEY`) |
| `VIBEOS_AI_BASE_URL` | OpenAI-compatible endpoint for `openrouter` (default OpenRouter) |
| `VIBEOS_AI_STUB=1` | use stub responses instead of any provider |
| `VIBEOS_AGENTS_DISABLED=1` | disable timer agents |
| `VIBEOS_SNAPSHOT_BUDGET` | cap the current-UI HTML sent as context (0 = no cap) |
| `VIBEOS_MODEL_UI` / `VIBEOS_MODEL_FAST` | override discovered model ids |

The active provider, the **skin**, and the UI/content **language (zh / en)** are also
switchable live in the **Settings** app.

## Scripts

```bash
bun run dev          # backend + frontend
bun run dev:backend  # backend only
bun run dev:frontend # frontend only
bun run build        # production frontend build → apps/frontend/dist
bun run typecheck    # typecheck all packages
bun test             # run the test suite
```

## Persistence

State lives in SQLite (`VIBEOS_DB_PATH`). On boot the kernel migrates the schema,
records the boot, restores open windows + their snapshots, and replays them to the
client via `s2c.boot.state`. Delete the DB file to reset the machine.

## Acknowledgements

VibeOS is an independent, unofficial reproduction inspired entirely by the
**Microsoft Build 2026 Vibe OS** demo. It is not affiliated with or endorsed by
Microsoft; all trademarks belong to their respective owners.

## License

[MIT](./LICENSE).
