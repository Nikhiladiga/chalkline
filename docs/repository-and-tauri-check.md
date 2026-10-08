# Repository setup and Tauri check — 7 October 2026

Application names and command examples were updated to Chalkline on 8 October. The original Tauri findings remain unchanged.

Repository: [Nikhiladiga/chalkline](https://github.com/Nikhiladiga/chalkline). The application is **Chalkline**. Local Git was initialized on `main` and connected to this repository. Generated bundles, dependencies, local settings, credentials and the local detailed-mode history bundle are excluded.

## Logical commits

The initial history is split into these groups, using the requested `label:single line commit message` format:

1. `docs:add project README`
2. `build:configure Electron packaging and development tooling`
3. `feat:add desktop backend and installed harness integrations`
4. `feat:add visual diagram editor and AI architecture generation`
5. `test:add desktop flows and diagram regression fixtures`
6. `docs:add architecture plans and release readiness guidance`
7. `test:add native WebKit feasibility probe and findings`

## Verification

`npm run check` passed TypeScript, lint and all **187 tests across 20 files**. `npm run build` passed for the Electron main process, preload and production renderer. No application behavior was changed in this repository setup.

The production renderer also ran in a native macOS WKWebView with the existing 24 diagram corpus fixtures and cached icons:

| Check | Result |
| --- | --- |
| React renderer initialized | Passed |
| CSS scope support in this WebView | Present |
| Valid fixture renders | 24 / 24 |
| Bounds matched Electron goldens within 2 pixels | 23 / 24 |
| Remaining bounds difference | `spanning-footer.json`: `e9` height 86 vs 89 pixels |
| Unhandled JavaScript errors | None recorded |
| Cached icon SVGs supplied to probe | 153 |
| Render warnings, summed across fixtures | 12 |
| Last scene serialized | 85,835 characters |

The probe serves the production build over localhost and injects a backend stub plus cached SVG responses. It does **not** verify Tauri's asset protocol, Rust commands, real harness generation, file dialogs, settings encryption, pointer interactions, PNG export or clipboard. The first direct-file loading attempt raised a JavaScript exception; HTTP loading succeeded. A real port needs to verify its own production asset delivery. The existing renderer can run in current native WebKit, with a small measured layout difference. This does not establish compatibility with older macOS WebViews or Windows/Linux.

## Reproduce on macOS

Use two terminals in the repository. Build and serve the renderer in the first:

```sh
npm run build
node node_modules/vite/bin/vite.js preview --outDir out/renderer --host 127.0.0.1 --port 4179 --strictPort
```

Compile and run the native probe in the second:

```sh
xcrun swiftc -module-cache-path /private/tmp/chalkline-swift-cache scripts/check-webkit.swift -o /private/tmp/chalkline-webkit-check
/private/tmp/chalkline-webkit-check "$PWD" http://127.0.0.1:4179/
```

Stop the preview server afterward. The probe uses the local legacy icon cache at `~/Library/Application Support/diagrammer/icon-cache`; missing cached icons can affect warnings and measurements. It prints a JSON report, exits after the check, and does not change app settings or saved diagrams. Exit code zero means a report was produced; inspect the report's fixture counts, errors and failures to assess compatibility.

## Can this app use Tauri?

**Yes.** React, the visual editor, document format and most browser-side diagram code can be reused. Installed Codex and Claude Code CLIs can still be spawned from a native Rust backend, so a Tauri port does not require switching to API keys. Electron IPC, filesystem and recovery handling, secure settings, icon loading, menus and process management need native replacements. PNG export is the major unresolved compatibility task because the current implementation depends on Chromium's screenshot protocol. See the [full migration assessment](tauri-feasibility.md).

This Mac already has Rust/Cargo 1.90 and Apple Command Line Tools. A Tauri project and dependencies have not been added. Follow the official [prerequisites](https://v2.tauri.app/start/prerequisites/) and [Vite frontend setup](https://v2.tauri.app/start/frontend/vite/) for a prototype. Tauri uses system WebViews, which explains the potential size reduction, but no Tauri binary or download-size benchmark has been produced. [Tauri architecture](https://v2.tauri.app/concept/architecture/).

Prove PNG and native bridge behavior before replacing the Electron release. Signing, notarization, the application's distribution license and clean-machine release checks remain separate release requirements; see [Homebrew preparation](homebrew-release.md).
