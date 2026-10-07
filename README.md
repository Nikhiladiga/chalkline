# Open Eraser

A local-first desktop editor for architecture diagrams. Generate diagrams from a description or a code folder using your installed Codex/Claude Code CLI, LM Studio, or an OpenAI-compatible API. Edit visually with searchable icons, drag and drop, eight connection ports per icon, or the JSON code pane. Export PNG, SVG and HTML.

Requires macOS 13 or later for the current macOS build. An installed, logged-in CLI is needed only when using that provider. Source-folder generation sends bounded code excerpts to your selected provider; review [data handling and scan limits](docs/code-folder-architecture.md).

## Development

Use Node.js 22.18 or later and pnpm. Run `pnpm install`, `pnpm dev`, `pnpm check`, and `pnpm test:e2e`. The postinstall script installs Electron and sets the macOS development application name.

`pnpm dist:mac` builds a local ad hoc signed app; it is not a notarized public release. See [Homebrew preparation](docs/homebrew-release.md) for signing, release artifacts and a personal tap. No public download or tap has been published yet.

The [7 October readiness review](docs/production-readiness-2026-10-07.md) records resolved defects, fresh verification and remaining release gates. The [Tauri assessment](docs/tauri-feasibility.md) explains potential size savings and the rendering/export work required.

Settings and cached icons remain in the legacy `diagrammer` application-data directory. Diagram files remain plain JSON; app settings, API keys and source folders are not embedded in them. Invalid code drafts are tracked as unsaved work and included in crash recovery. Save requires valid code. Use the app's File → Open command; it does not claim the system-wide `.json` association.

Generation runs without CLI tools, plugins, MCP or project rules. Codex requires a version supporting `--ignore-user-config` and `--ignore-rules`; generation keeps its saved login but uses the model selected in the app, with a CLI-built-in default when `default` is selected. Personal Codex config model/provider overrides are not used for generation.

The rendering engine is built on the MIT-licensed Eraser Diagrams packages; engine and font notices are bundled. The project owner still needs to choose the application's distribution license. Service logos remain their owners' marks. Icons are loaded from a local cache or the hosted icon source; an empty cache needs network access, and hosted icon availability is not guaranteed.
