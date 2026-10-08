# Chalkline

Chalkline is an Electron desktop architecture diagram editor built with React and TypeScript. See `README.md` for product features, setup and release documentation.

## Commands

- `pnpm dev` — start the desktop app with hot reload.
- `pnpm check` — TypeScript, Biome and unit tests.
- `pnpm test:e2e` — production build and Playwright Electron tests.
- `pnpm dist:mac` — local ad hoc signed macOS bundle; not notarized.
- `pnpm release:mac` — signed/notarized release; see `docs/homebrew-release.md`.

Live CLI acceptance tests are opt-in and use the user's login and quota. Source-folder generation sends selected excerpts to the selected provider.

## Repository layout

- `src/main` — Electron windows, files, settings, icon protocol/cache, code scanning, provider adapters and PNG export.
- `src/preload` and `src/shared` — typed, validated IPC bridge with context isolation and sandboxing.
- `src/renderer/engine` — Eraser renderer integration, measurement and SVG export.
- `src/renderer/doc` — document operations, state, recovery and undo/redo.
- `src/renderer/ai` — prompts, parsing, repair, icon resolution and edit merging.
- `src/renderer/layout` — overlap checks and ELK auto-layout.
- `src/renderer/ui` — canvas, icon palette, code editor and settings.
- `e2e` — native desktop regression tests; `docs` — user and release guides.

## Conventions

- Display/native name: **Chalkline**. Package/cask/artifact name: `chalkline`. Bundle ID: `dev.chalkline.app`.
- Preserve the legacy `diagrammer` user-data directory and existing settings/recovery compatibility.
- Diagram documents contain `{ entities, connections }`; keep app metadata outside saved diagrams.
- Use the pinned `@eraserlabs/*` 0.2.0 packages and retain upstream/license/font notices in `third_party/eraser-diagrams`.
- Provider calls run in main; API keys never enter the renderer. Providers include Codex CLI, Claude Code CLI, LM Studio and OpenAI-compatible APIs.
- Preserve isolated CLI generation and bounded source scanning. Default code-folder diagrams describe runtime architecture, rather than import graphs.
- Keep document session/revision guards, invalid-code recovery and atomic writes intact. User edits must survive delayed save and AI completions.
- Unset `ELECTRON_RUN_AS_NODE` for desktop launches; some development shells export it.
- Verify changes with appropriate checks. Get explicit approval before committing and pushing or publishing a release.
