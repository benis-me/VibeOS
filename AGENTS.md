# VibeOS

Guidance for AI coding agents working in **VibeOS** — an AI-hallucination-driven
operating system in the browser. Except for the core runtime, every window's UI
is generated in real time by AI via a pluggable provider (CodeBuddy / Claude Code
/ Codex / OpenRouter).

## Runtime boundaries

- AI providers run on the backend. Frontend state mirrors backend state; SQLite is the runtime source of truth and file content lives in `~/.vibeos/disk`.
- Model access goes through the shared provider seam. Generated content is untrusted: preserve validation, opaque-origin isolation, revision guards and cancellation.
- All DB writes use `db/repositories/*` and `writeQueue`. Preserve legacy-data backups, migration recovery, user files and application/version identities.
- Shared protocol/domain types belong in `@vibeos/shared`; keep both ends compatible. Use TypeScript, ESM and `.ts` import extensions.

## Task references

Read only sections needed for the current change; paths in these documents are repository-relative.

- Provider routing, skins, rendering, events, syscalls or files: [runtime contracts](docs/agent-runtime-contracts.md).
- Application versions, storage migration or memory: [applications and memory](docs/applications-and-memory.md).
- Interactive iframe runtime or local handlers: [interactive runtime](docs/interactive-runtime.md).
- App communication and event ordering: [communication](docs/communication.md).

## Commands

```bash
bun install
bun run dev          # backend (:7720) + frontend (:7730), via scripts/dev.ts
bun run dev:backend  # backend only
bun run dev:frontend # frontend only
bun run build        # production frontend build
bun run typecheck    # typecheck all three packages
bun run verify       # typecheck + biome check + tests; exit code = pass/fail
```

Offline / no-model mode: `VIBEOS_AI_STUB=1 bun run dev` (deterministic stub UI).
Useful env: `PORT`, `VIBEOS_DB_PATH`, `VIBEOS_AGENTS_DISABLED=1`, `VIBEOS_LOG_LEVEL=debug`.


## Verification

- TypeScript, protocol, build configuration or dependency changes require the affected packages' typecheck; shared-type changes include both frontend and backend. Documentation and asset changes use their relevant checks.
- For rendered UI or behavior changes, exercise the affected real flow. Stub mode proves only stub behavior. Fix change-related failures, recheck the affected behavior, then stop.
- If a Node tool fails because `NODE_OPTIONS` contains an invalid `$bunfs` preload, remove that failing preload for the command while preserving unrelated options. Do not clear `NODE_OPTIONS` unconditionally. Existing dev/provider launchers handle that known preload case.

## Product rules

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

