# Decisions

| Date | Decision | Reason | Numbers |
| --- | --- | --- | --- |
| 2026-10-02 | Default LLM provider is **LM Studio** (OpenAI-compatible `http://127.0.0.1:1234/v1`). Also OpenAI-compatible URL + key and Anthropic key. Ollama/vLLM later (they speak the same OpenAI-compatible API). | User correction; LM Studio is installed. Replaces D4's Ollama default. | — |
| 2026-10-02 | Render **inline in the renderer document**, not in an iframe (D3 correction). | Upstream `playground/RenderPreview.tsx`: Chromium skips SVG filters inside `<mask>` in iframes, so washes render wrong. | — |
| 2026-10-02 | Single package (`src/main`, `src/preload`, `src/renderer`, `src/shared`) instead of a pnpm monorepo (D6 was proposed). | Fewer moving parts; `src/renderer/ai` and `engine` stay pure for a later `training/` workspace. | — |
| 2026-10-02 | Undo = whole-document snapshots (cap 200), not immer patches (D7 was proposed). | Documents are a few KB; snapshots are simpler and correct. | — |
| 2026-10-02 | Icons are not bundled. `icons://` loads user dir → disk cache → hosted Eraser bucket. `icons/names.json` (3856 names from the public bucket listing) feeds the AI vocabulary and picker. | Licensing (§11). | 3856 names |
| 2026-10-02 | SVG export = `<foreignObject>` around the serialized scene with fonts embedded as data URIs. | Pixel-identical to the render; opens in browsers/Quick Look. Ceiling: tools without foreignObject support (Figma, Illustrator) show nothing — upgrade with a DOM→SVG converter. | — |
| 2026-10-02 | Fine-tuning (Phases 6–7) not built in this pass. | Not needed for the done criteria. | — |
| 2026-10-02 | Golden test: all 24 `fixtures/corpus` documents render in Electron 44 with every entity box within ±2 px of `__goldens__/*-darwin.json`. Tolerance kept at 2. | Phase 1 acceptance. | 24/24 |
| 2026-10-02 | Warm render benchmark (median of 5, icons cached, M5 Pro): small (4–11 el.) 2–6 ms; medium (30–47) 5–39 ms; large (56–120) 29–53 ms. Cold first render with icon downloads: 0.4–5 s. | Phase 1 benchmark. | see left |
| 2026-10-02 | **S1 = option A**: full `run()` per drag frame, newest request wins (older queued renders are skipped). | Medium renders < 40 ms, so live re-routing is cheaper to build than partial routing. Ceiling: very large diagrams (>150 el.) may drop to ~15 fps; upgrade to `@eraserlabs/layout` partial routing then. | ≤53 ms |
| 2026-10-02 | Renderer CSP allows `'unsafe-eval'`. | Ajv (inside `@eraserlabs/resolve`) compiles schemas with `new Function`. Sandbox, context isolation and no Node in the renderer still hold; untrusted LLM text never reaches eval — it only reaches the resolver as data. | — |
| 2026-10-02 | **S3 = option (b)**: loose envelope JSON Schema via OpenAI `response_format: json_schema` (fallback to no schema on HTTP 400). | On `qwen/qwen3.6-35b-a3b` (LM Studio, MLX 4-bit, M5 Pro): with schema 4/4 valid first try, 4.2–4.4 s each. Without schema the thinking model reasoned for >10 min before answering — unusable. Option (a) (oneOf over all tag schemas) not needed: the resolver + repair loop catch per-tag errors. | 4/4, ~4.3 s |
| 2026-10-02 | LM Studio streams a thinking model's schema-constrained output in `delta.reasoning_content`, not `content`. The client uses content when present, else the reasoning text. | Found in S3 (0 chars of content). | — |
| 2026-10-02 | Phase 3 acceptance on `qwen/qwen3.6-35b-a3b` via LM Studio, run through the real app (`e2e/lmstudio.spec.ts`): "AWS serverless API: API Gateway, Lambda, DynamoDB and S3 inside a VPC" → **10/10** valid, rendered, overlap-free, correct icons, VPC group. 4.3–7.4 s per run. Follow-up NL edit ("add an SQS queue…") kept all existing positions, added the node with no overlaps, icon fix-up `aws-sqs → aws-simple-queue-service`. | Phase 3 acceptance (≥ 8/10). | 10/10 |
| 2026-10-02 | Two diagram **themes** (toolbar): Dark (default, eraser.io-like: canvas is the ground, light ink/lines) and Light (white sheet). Implemented as a render-time transform (`engine/theme.ts`) that fills colors only where the author set none and maps palette tokens to dark tints; the saved document stays theme-free. Exports follow the theme. | User: white sheet "does not look polished". Upstream templates have no dark theme. Ceiling: Legend and DatabaseTable text colors are hard-coded dark upstream, so those stay light cards in Dark; brand logos that are black (SendGrid, Slack) stay black. | — |
| 2026-10-02 | Two **AI styles** (AI panel): Simple (icons + captions in one titled group, like eraser.io) and Detailed (title, legend, colored tiers, icon cards with detail lines, numbered main path, dashed failure paths, notes). Separate few-shots and rules per style. | User asked for both looks. Real model: email-pipeline prompt → Simple ~12 s, Detailed ~27 s. | — |
| 2026-10-02 | Auto-layout: spacing options on every ELK container level; 2+ top-level groups → tier layout (each tier laid out alone, stacked full-width, 90 px apart, title top-left, legend top-right, unconnected tier members chained into a row). Upstream connection `badge` is accepted by the schema but not drawn in 0.2.0, so numbered steps go in labels ("1 · HTTPS"). | Fixes squeezed labels and scattered tiers seen with the real model. | — |
| 2026-10-02 | 32 px margin around the diagram and true text extent (spilled captions) on canvas sheet, PNG and SVG. | Upstream scene box ends at the outermost label with no margin and ignores text that overflows its caption box. | — |

## Eraser look in Dark (2 Oct)
- Dark theme fills in `typeface: "rough"` (Shantell Sans, Eraser's hand-drawn face) wherever the author set none: element, text runs, container titles, connection labels. Light keeps Inter.
- One-color icons (no paint, or only black) get `currentColor` in the icon loader, so they follow the theme ink: white on dark, near-black on light. Colored logos are unchanged.
- Removed the toolbar Add menu and code toggle. Side panes collapse to a 36px rail from their own header button.
- Historical: the AI Style switch changed the next run and offered "Redraw as <style>" after a generation. Removed on 5 Oct.

## Simple generation only (5 Oct)
- Removed the Detailed mode selector, redraw action, style settings, dedicated prompts, examples, and card helper. Simple rules and examples now drive every generation and edit.
- Existing settings with `aiStyle` load without losing other preferences; the obsolete field is ignored. Rich elements in existing diagrams remain supported.
- The pre-removal source is preserved in `backups/detailed-mode.bundle`, branch `backup/detailed-mode`. See `backups/README.md` for restoration instructions.

## Codex model discovery and dragging beyond the origin (5 Oct)
- Codex models come from the installed CLI's `app-server` `model/list` endpoint after initialization, including pagination. Refresh queries the current catalog again; `CLI default` leaves the model choice to the CLI. Discovery errors are shown in the AI panel.
- Codex launchers get the installed Node runtime directory on PATH, including when Finder starts the application with a minimal PATH. Discovery and generation share this environment.
- Dragging past x/y = 0 translates the document into positive coordinates and compensates the canvas pan so stationary elements stay in place. Container membership updates during the drag; moving outside removes the parent and moving inside joins the smallest eligible container. A gesture remains one Undo step, with connections preserved.

## Painted footprints for layout (2 Oct)
- `RenderOk.painted` = each entity's box united with the text inside its wrapper (an icon's caption). Overlap checks, ELK sizing, placeNew and fitContainers all use it, so a caption running into the next icon now triggers auto-layout. ELK and placeNew apply footprint→glyph offsets so captions wider than the icon stay centred.
- The title Textbox and Legend always form a header row on top (legend right of the title, never over it), in tier and non-tier layouts.
- Empty Groups/Lanes/Pools are laid out as containers (ELK-sized), not as giant leaves.
- Dark: a group/shape color outside the palette tokens (gray, black, #888) keeps a dark body and moves to the border.

## Claude Code CLI replaces the Anthropic API provider (2 Oct)
- Provider `claude-code` (now the default) runs the installed `claude` once per request: `-p --output-format stream-json --include-partial-messages --json-schema <schema> --system-prompt-file <tmp>`, conversation on stdin as a `<user>/<assistant>` transcript. The answer is `result.structured_output`; `input_json_delta` chunks drive the progress counter.
- Isolation: fresh empty cwd, `--tools ""`, `--setting-sources ""` (no user hooks, plugins, skills or CLAUDE.md), `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence`. Measured: 643 input tokens of CLI overhead; only the environment and email blocks remain.
- Uses the user's Claude login; no API key. Binary: Settings path, else PATH, ~/.local/bin, ~/.claude/local, Homebrew, /usr/local, then `$SHELL -lc 'command -v claude'` (Finder-launched apps have a bare PATH).
- Models: default (the CLI's own choice), opus, sonnet, haiku. Temperature does not apply.
- Saved `anthropic` settings migrate to `claude-code`. `DG_LLM_BASE_URL` forces an OpenAI-compatible provider (tests); `DG_LLM_PROVIDER` overrides.
- Measured (default model, Detailed): email-pipeline generate 39 s, 22 entities, 4 tiers, 0 overlaps; "add a Redis cache" edit 32 s and a rename 25 s, both with zero damage (ids, tags, parents, positions, texts, lines all kept).

## Renamed to Chalkline (2 Oct)
- A chalk line snaps straight lines for builders; the app snaps boxes and lines into diagrams on a chalkboard-dark canvas with a chalk-style font.
- Icon master: `build/icon.svg` (rendered to `build/icon.png` with `rsvg-convert -w 1024 -h 1024`); electron-builder makes the .icns/.ico from the PNG. `pnpm dev` sets the Dock icon from the same PNG.
- userData stays `~/Library/Application Support/diagrammer`, so settings, keys and the icon cache survive the rename.

## Visual icon editor (6 Oct)
- The left sidebar defaults to Icons and switches to Code while retaining both mounted panels, search and raw drafts. Shared catalog search includes aliases, popular icons and provider categories; thumbnails are lazy and results load incrementally.
- Native drag/drop reuses document insertion, coordinate normalization and container membership. Drops and click/keyboard additions are one Undo step; unrelated drag data is ignored.
- Icons expose eight zoom-independent connection hit targets with a live preview and nearest-port target snapping. Connections store exact source/target ports. Escape, pointercancel, focus loss and empty drops cancel without history; the resize grip is separate.
- Extend only Relationship port enums with four corners. Reuse the installed Eraser corridor router's relative-port API to obtain anchored geometry, then paint/export it through the existing renderer. Corner port JSON is an app schema extension; unmodified external Eraser validators may reject it.
- Existing authored straight polylines and manually positioned straight labels are preserved. Moving/resizing continues to clear stale route geometry while keeping selected port names.
- Verification: TypeScript/Biome and 167 unit tests; full desktop suite 18 passed / 2 optional live-AI tests skipped. New desktop tests cover 900×600 palette labels, alias/category/incremental browsing, preserved code drafts, tab-key history, transformed/group/near-origin drops, all eight anchors after move/resize, cancellation, save/reopen and PNG/SVG export. Independent review findings were reproduced before correction.
- Build succeeds. This updates source/build output; it does not publish or replace an installed desktop bundle. Existing production-readiness persistence findings remain outside this change.

## Larger icon browsing (6 Oct)
- Make service logos the primary visual in both browsers: modal previews are 80px with 72px artwork (previously 32px/24px), sidebar artwork is 64px (previously 30px). Wider, taller tiles and 12px two-line labels improve recognition and readability; SVG proportions and native colors are preserved.
- Center the native drag preview on its actual new dimensions. Humanize hyphenated modal labels while retaining canonical icon names for selection.
- Build, TypeScript and Biome pass. Four focused desktop tests pass, including picker sizing/scrolling at 1440×900 and 1000×700, sidebar layout at 900×600, search, drag/drop, connector gestures and export. Screenshots inspected.

## Architecture from a code folder (6 Oct)
- Add AI Source → Code folder, native folder selection, local scan preview and coverage/details. Generate and Apply rescan current working-tree source and use the selected existing provider/model. Folder selection alone does not call a provider; handles are session-only and source paths/permissions are not added to diagram JSON.
- Archify repository-authoring principles inform entry-point/import/I/O evidence and uncertainty; its code, HTML renderer and theme are not installed or copied. Existing Eraser prompt/schema, validation/repair, icon matching, layout, concurrent-edit guard, Undo and export remain the output pipeline. Repository calls omit unrelated few-shot topologies. Source notes are short, wide, and outside system groups.
- Use standard `ignore` 7.0.5 for nested ignore rules/negations. Skip dependencies/build output, binary/large files, symlinks, environment/credential/key files and agent instruction files. Literal secret/URL credential redaction is best effort. Treat source as untrusted data, never import or execute it. The selected provider receives bounded excerpts only when the user generates/applies.
- Inventory/read/context budgets and module-fair evidence prevent runaway scans. Missing excerpts, unreadable folders/files and unsafe ignore scopes disclose partial coverage. Ignore-rule errors fail closed; root errors stop scanning, nested failures skip the affected subtree. Existing harness isolation remains enabled.
- Independent review's three scanner findings were reproduced and corrected with regressions. Final TypeScript/Biome/build pass; 176 unit tests pass. Full desktop suite: 19 passed, 2 existing opt-in live-AI checks skipped. Final fake-installed-Claude and real Codex folder acceptances pass; Codex generated 7 entities/5 relationships for API/Postgres/Redis/worker evidence without unsupported AWS nodes, saved/exported, and changed no source files. Minimum-window UI and generated layout screenshots inspected.
- Guide: `docs/code-folder-architecture.md`. This is bounded source evidence rather than a full semantic proof of every language/runtime. No continuous watcher, ZIP upload, automatic clone, installed-app replacement or release publication.

## Release readiness, naming and Homebrew (7 Oct)
- Rename public/package/native/UI/RPC branding to Open Eraser, cask/artifact token `open-eraser`, bundle ID `dev.open-eraser.app`. Keep the existing icon and explicit legacy `diagrammer` data directory.
- Resolve prior persistence blockers: session/revision-guarded save completions; tracked raw code drafts with recovery; save refusal for invalid code; ordered recovery clearing on deliberate discard; atomic diagram/recovery replacement. Preserve recovered raw text and reject stale code validation/Auto-layout/AI draft adoption.
- Codex generation explicitly ignores user config/rules and disables filesystem/search/browser/agent/plugin/app/hook tools. Keep saved auth and use the app's selected model; built-in default replaces any personal Codex-config default/provider for generation. A real CLI against a localhost mock demonstrated why read-only sandboxing alone was insufficient.
- Fix Claude stdin EPIPE/main-crash and pre-cancel allocation paths; use maintained pinned cross-spawn7.0.6 for both providers and add Windows PATH/PATHEXT/npm/WinGet discovery. Fix PNG timeout/load-error listener cleanup. Remove unimplemented system JSON association, retaining File → Open.
- Prepare local ad hoc mac builds plus separate fail-closed Developer ID/notarization release script, JIT entitlement, real-archive metadata/CPU/icon/SHA-256 cask generator, and packaged native smoke verifier. No public repository URL, license or Apple credentials were invented; no release/tap was published.
- Final verification: 187 unit tests/20 files, TypeScript/Biome, production build; full desktop suite22 passed/3 opt-in live checks skipped; additional real installed Codex folder acceptance6 entities/4 relationships, saved/exported, source unchanged. Packaged ARM64 native name/icon/model discovery/zero render errors/save/PNG/SVG passed with Finder-like PATH. Actual Windows/Intel/Linux, downloaded quarantined installation/upgrade, and notarization remain release gates.
- Readiness report `docs/production-readiness-2026-10-07.md`; release steps `docs/homebrew-release.md`; Tauri analysis `docs/tauri-feasibility.md`. Tauri is feasible, but PNG CDP export, WebView rendering measurement, native bridge/scanning and secure-key migration need proof. No full Tauri migration was requested or performed.
