# Open Eraser

(Formerly Chalkline and Diagrammer. Its userData folder is still `diagrammer`.)

Electron desktop diagram editor on the Eraser Diagrams JSON format. Spec: `PLAN.md` (§5 = upstream integration notes). UI tokens: `DESIGN.md`. Deviations: `DECISIONS.md`.

## Commands
- `pnpm dev` — run the app (hot reload)
- `pnpm check` — typecheck + biome + unit tests (keep green)
- `pnpm test:e2e` — build + Playwright Electron tests
- `DG_CLAUDE_E2E=1 pnpm exec playwright test e2e/claude.spec.ts` — real Claude Code CLI acceptance (uses your Claude quota)
- `pnpm dist:mac` — local ad hoc mac build into `dist/` (not notarized)
- `pnpm release:mac` — signed/notarized mac release; see `docs/homebrew-release.md`

## Layout
- `src/main` — Electron main: window, `icons://` protocol, files, settings, LLM HTTP + Claude Code CLI (`claudeCli.ts`), PNG export
- `src/preload` — typed `window.api` bridge (contextIsolation + sandbox)
- `src/shared` — IPC zod schemas shared by main and preload
- `src/renderer/engine` — resolver + inline `__eraser.run` render, measured JSON, SVG export
- `src/renderer/doc` — pure document ops + zustand store (undo)
- `src/renderer/ai` — prompt, parsing, repair loop, icon fix-up, position merge
- `src/renderer/layout` — overlap checks, ELK auto-layout
- `src/renderer/ui` — React components

## Conventions
- `@eraserlabs/*` pinned at exact 0.2.0. Upstream test fixtures + LICENSE: `third_party/eraser-diagrams` (full reference clone, if wanted: `git clone https://github.com/eraserlabs/eraser-diagrams vendor-ref/eraser-diagrams`, gitignored).
- Document = `{ entities, connections }` only; no app metadata inside it.
- LLM calls only from main. Renderer never sees API keys. Providers: Claude Code CLI (default), LM Studio, OpenAI-compatible.
- VS Code shells export `ELECTRON_RUN_AS_NODE=1`; scripts and e2e unset it.
