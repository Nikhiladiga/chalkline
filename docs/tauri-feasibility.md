# Tauri feasibility — 7 October 2026

**A Tauri port is feasible and should reduce the installed app size substantially, but it is a backend and export migration, not a package-manager substitution.** Keep the current Electron release as a usable baseline while proving rendering and PNG export in a small Tauri build. No Tauri migration was performed by this review.

The freshly built ARM64 Electron app measured about **300 MiB installed**, with **287 MiB in frameworks** and **13 MiB in resources**. This points to a large opportunity: Tauri uses the operating system's WebView and a compiled Rust host rather than shipping Chromium/Node. This is an inference from the measured Electron bundle, not a measured Tauri size or a guarantee of lower memory usage. macOS uses WKWebView, Windows uses WebView2, and Linux uses WebKitGTK. [Tauri architecture](https://v2.tauri.app/concept/architecture/), [WebView versions](https://v2.tauri.app/reference/webview-versions/).

## Reuse and replacement

| Area | Port approach |
| --- | --- |
| React, CodeMirror, CSS, Zustand document/history | Reuse; build the renderer with standard Vite instead of electron-vite. |
| Diagram parsing/validation, prompts, repair, icon matching, layout, connection routing, SVG/HTML generation | Reuse TypeScript/browser code. Validate font metrics and DOM-based measurement in each WebView. |
| `window.api`, shared IPC schemas, preload, `ipcMain` | Retain a typed frontend adapter, implement Tauri commands/events with native validation and scoped capabilities. No Electron preload in Tauri. |
| File dialogs, atomic save/recovery, menus, close confirmation, clipboard, window lifecycle | Replace with Rust/Tauri implementations/plugins. Preserve the recovery format and existing data directory. |
| CLI discovery, spawn/stream/Stop, Codex JSONL and model-catalog RPC, Claude stdout parsing | Spawn the user's installed executables from Rust. Continue safe argv handling, empty temporary CWD, isolated tools/config and process cancellation. No API-only switch is required. |
| Code-folder scan | Port traversal, `.gitignore`, symlink safety, secret filtering, budgets and evidence selection to Rust; preserve the existing acceptance fixtures. |
| Settings/API keys | Replace Electron `safeStorage` with native secure key storage. Prove migration of existing encrypted keys before switching. A different framework does not automatically decrypt Electron's saved key format. |
| `icons://` protocol and hosted cache | Implement a scoped protocol/asset loader and Rust-side HTTP cache. Keep network access out of the general renderer bridge. |
| PNG export and PNG clipboard | **Largest specific blocker:** current `src/main/export.ts` creates a hidden Chromium window and uses CDP `Page.captureScreenshot`. Tauri does not provide this Electron/CDP path. Prototype rendering to PNG with the same fonts, captions, groups, HTML/SVG content and transparency before committing to the port. |
| Packaging/testing | Replace electron-builder and Electron Playwright launch fixtures. Retest real WKWebView/WebView2/GTK behavior. Tauri signing/notarization is still needed for macOS distribution. |

## Rendering caveats

The current rendering library uses generated templates/inline browser code and CSS `@scope (... ) to (...)` in `@eraserlabs/render/dist/browser/index.js`. Layout is measured from actual DOM and fonts. The current Chromium goldens are not automatically valid in WebKit. WebKit shipped `@scope` in Safari 17.4; test the actual WKWebView versions supported by the selected macOS floor, or replace the scoping layer where unsupported. [WebKit's scoping implementation](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/).

SVG exports embed the rendered scene and fonts, including HTML/foreignObject content. A pure SVG rasterizer may not reproduce that HTML, CSS scoping or text wrapping. Shipping headless Chromium solely to preserve PNG output would consume much of the expected size saving. Native WebView capture or a deliberately redesigned PNG renderer needs a fidelity proof.

Using a Node sidecar can preserve the existing main-process TypeScript sooner; Tauri supports that approach. It adds a bundled runtime and IPC/process lifecycle, so it should be a temporary option if the objective is the smallest application. Prefer Rust native commands for this app's small backend over assuming users have Node installed. [Tauri Node sidecar guidance](https://v2.tauri.app/learn/sidecar-nodejs/).

## Recommended proof before a full port

The first engine compatibility check now has evidence: the current production renderer ran in native WKWebView on this Mac with stubbed backend calls. All 24 corpus diagrams rendered without global JavaScript errors; 23 matched the Electron goldens within 2 pixels, and one footer differed by 3 pixels in height. This is a WebKit check, not a completed Tauri shell or export proof. See [results and reproduction](repository-and-tauri-check.md).

1. Load the current renderer in a Tauri shell on macOS with stubbed native calls. Render the 24 fixture corpus; compare bounds, fonts, captions, nested groups, eight-port drag/connector behavior and minimum-window UI against Electron.
2. Prove PNG 1×/2×, transparent PNG and clipboard on large/overflowing diagrams. Preserve SVG/HTML fidelity. Select the export approach based on that evidence.
3. Implement the typed native bridge: files/recovery/settings/icons first, then installed harnesses/models/Stop and bounded code-folder scans. Keep the same saved document format and provider abstraction.
4. Run the data-loss regressions, security/isolation checks and installed-harness acceptance on macOS, Windows and Linux. Test actual system WebViews, not only a browser automation build.
5. Measure release bundle/download size, startup and memory, then decide whether the measured savings justify completing the migration. Apple signing/notarization remains necessary for normal downloaded-app trust. [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).

Ship the tested Electron beta through a personal tap first if early access matters more than size. Prove the Tauri renderer/export in parallel with that release work; avoid combining a full framework migration and the first public release into one untested change.
