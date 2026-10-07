# Production readiness review — 7 October 2026

**Verdict: suitable for a macOS Apple Silicon beta; not yet ready for an unrestricted public release.** The confirmed code-level release blockers found in this review are fixed and the local packaged application works. Remaining release gates are a chosen distribution license, public repository/release/tap, Apple signing/notarization, and clean-machine installation/upgrade checks. Windows, Intel macOS and Linux releases have not received native acceptance testing.

This was a focused whole-application review of the renderer/document lifecycle, generation and editing, source scanning, native IPC/providers/files/settings/icons/exports, packaging and existing regressions. It includes independent backend and persistence review. It is not a guarantee that every AI-generated architecture is correct or an exhaustive security audit.

## Findings resolved now

| Priority | Confirmed problem | Fix and evidence |
| --- | --- | --- |
| P1 | Save marked newer unsaved edits as saved; a late Save As could rename a different opened document. | `src/renderer/doc/store.ts:128` and `src/renderer/ui/actions.ts:92` guard completions by document session/revision. Concurrent saves are serialized at the action boundary. Store regressions and delayed native Save As tests prove the written snapshot stays separate from subsequent edits. |
| P1 | Invalid JSON code edits were not dirty or recoverable; Save silently wrote the previous valid diagram. | Raw code is stored separately, marks the document dirty immediately, participates in recovery/close guards, and blocks saving until valid. Recovery restores the actual raw text into CodeMirror. Desktop tests cover invalid edits, Save refusal, recovery restore, tab switching, New cancel/discard and recovery clearing. |
| P1 | A failed AI draft could replace newer unsaved raw code. | `src/renderer/ui/AiPanel.tsx` checks revision before draft adoption. Newer code remains intact. Successful AI replacement requires explicit confirmation before discarding a raw draft. A delayed failed-provider desktop regression preserves exact newer editor text. |
| P2 | Pending code validation and Auto-layout could replace newer canvas edits. | Revision guards reject stale completion; unit coverage protects pending validation, and the renderer uses the same document revision for AI concurrency checks. |
| P2 | Intentionally discarded edits remained eligible for recovery. | Close waits for queued recovery clearing, and recovery writes/clears are ordered. New/Open clear replaced recovery; declining restoration clears it. The real close handler's Discard branch is tested. |
| P1 | Codex's read-only sandbox still offered file-reading shell tools, web search and inherited user tools/config despite the app's isolated-generation promise. | `src/main/codexCli.ts:126` ignores user config/rules and disables shell, browser, image, agents, apps, plugins, hooks and search capabilities for generation. A real CLI/localhost mock confirmed the exposed-tool difference without quota. A real Codex generation passed after the change. Auth remains the user's saved login. Generation uses the app-selected model; personal CLI provider/model config overrides are intentionally not used. |
| P1 | Claude's stdin broken pipe could cause an uncaught exception in the Electron main process. | `src/main/claudeCli.ts:196` handles stdin errors. An exiting executable and a large prompt reproduce/protect the failure path. |
| P2 | Pre-cancelled Claude requests dereferenced an unspawned child and leaked temporary files. | Cancellation is checked before discovery or temporary-file allocation; child cleanup also guards missing children. Regression passes. |
| P2 | Windows CLI discovery ignored native executable/npm wrapper extensions and installer paths. | PATH/PATHEXT/npm/WinGet/native paths are resolved, and both providers use pinned maintained `cross-spawn` for safe launcher argument handling. Windows path fixtures pass; actual Windows execution is still a release gate. |
| P2 | PNG render timeout/load failure leaked IPC listeners. | `src/main/export.ts` always cleans its IPC/load listeners and timer, rejects main-frame load failure promptly, and destroys the export window. Unit failure-path checks and real desktop/packaged exports pass. |
| P2 | Packaging registered all `.json` files without implementing OS file-open handling. | Removed the incorrect association. File → Open remains supported; the app no longer claims double-click support it cannot fulfill. |
| Release | Public executable and UI still used Chalkline. | Updated package/bundle/native-window/menu/toolbar/HTML/RPC branding to **Open Eraser**, identifier `dev.open-eraser.app`, and cask/artifact name `open-eraser`. Legacy `diagrammer` user data is preserved. |

User diagram writes now use a temporary sibling file followed by atomic replacement, rather than truncating the existing diagram. Recovery writes use the same approach. Failure to record the recent-file list no longer misreports an already successful save as failed.

## Fresh verification

| Check | Result |
| --- | --- |
| `pnpm check` equivalent (`npm run check`) | **Passed: 187 unit tests in 20 files**, TypeScript and Biome |
| `npm run build` | Passed production main/preload/renderer build |
| Complete ordinary desktop suite | **22 passed, 3 optional live-provider tests skipped** |
| Rendering fixtures | 24 corpus layouts match macOS golden boxes within ±2 px |
| Real installed Codex source-folder generation | Passed: 6 entities and 4 connections for a synthetic API/Postgres/Redis/worker project; no unsupported AWS topology, valid diagram, save/SVG export, source unchanged |
| macOS ARM64 ZIP packaging | Passed; ad hoc signed local testing build, **not notarized** |
| Packaged app launch with Finder-like `/usr/bin:/bin` PATH | Passed `app.isPackaged=true`, native name **Open Eraser**, eight Codex models plus default, zero render errors, save/PNG/SVG export |
| Packaged icon and metadata | Passed bundle/display/executable names, ID, version 0.1.0, `icon.icns` (317,226 bytes), macOS minimum 13.0, and deep/strict signature integrity check |
| Homebrew generator | Validates real ZIP name/version/identity/icon/Mach-O CPU, computes SHA, generated Ruby passes syntax check. Test used a reserved example repository in `/private/tmp`; no real public cask URL was fabricated. |
| Signed-release guard | Refuses missing Developer ID identity/notarization credentials. Full Developer ID signing, notarization/stapling and Gatekeeper acceptance remain untested until credentials are supplied. |

The sandbox initially prevented Electron startup and localhost provider tests; the same tests passed outside the sandbox with isolated profiles/fixtures. Those were environment restrictions, not failures hidden by adjusting tests.

## Final binary name and icon

The actual freshly built executable is:

```text
dist/mac-arm64/Open Eraser.app/Contents/MacOS/Open Eraser
```

The application bundle reports `CFBundleName`, `CFBundleDisplayName`, `CFBundleExecutable` and native `app.getName()` as **Open Eraser**. Its icon resource is embedded and referenced by the bundle, and the 1024 × 1024 source icon was visually inspected. The existing drawing/connector logo is retained; the name change did not introduce a new logo. These checks cover the final macOS bundle, not only the development toolbar.

The local archive is `dist/open-eraser-0.1.0-arm64.zip`, approximately 124 MiB downloaded and 300 MiB installed. This is a local test artifact, not the signed/notarized public download. Windows/Linux use the same name/icon configuration, but their actual executable/installer appearance has not been verified on those operating systems. Already-installed older app copies are not replaced by this build.

## What still needs preparation

1. **License and public repository.** Choose the project license, add its license file, choose the GitHub owner/repository, and create a clean repository. Preserve third-party notices and verify distribution terms for service logos. The root directory currently has no `.git` repository. No license was chosen on your behalf.
2. **Developer ID and notarization.** The current local app is ad hoc signed. Normal macOS public distribution requires the corresponding Apple identity and notarization checks; the official Homebrew cask repository requires Gatekeeper-compatible apps. [Homebrew requirements](https://docs.brew.sh/Acceptable-Casks).
3. **Clean-machine/macOS acceptance.** Test a downloaded/quarantined, signed artifact on the minimum supported macOS and the latest macOS, including provider login/discovery, file/folder permissions, recovery, upgrade and uninstall. The current installed Electron requires macOS 13+, reflected in package and cask metadata. [Electron's macOS support change](https://www.electronjs.org/docs/latest/breaking-changes).
4. **Platform scope.** Publish the tested Apple Silicon build first. Do not advertise Windows/Intel/Linux as production supported until their packaged installers, CLIs, fonts/layouts, permissions and exports pass native tests.
5. **Provider/icon availability and architecture accuracy.** Hosted icons require network on an empty cache; disabling hosted icons leaves missing-service placeholders until cached/local SVGs exist. Code-folder scans intentionally limit coverage and report it, and secret filtering is best effort. AI output requires user review; a valid JSON diagram does not prove complete or semantically correct architecture. Real generation was checked on one small synthetic project, not every project size/language.

## Homebrew and Tauri deliverables

[Homebrew release steps](homebrew-release.md) explain the Apple credentials, archive/release/tap setup, checksums, install/audit commands and update process. `scripts/release-mac.mjs` prepares a fail-closed signed release; `scripts/prepare-homebrew.mjs` prepares a real cask from its archive; `scripts/verify-mac-bundle.mjs` checks the packaged app. Publication remains pending the owner/repository, license and credentials.

[Tauri feasibility](tauri-feasibility.md) maps reusable frontend code and required native replacements. A large size reduction is plausible because the current Electron frameworks account for most of the bundle, but no Tauri build or size benchmark was produced. Installed Codex/Claude support can remain. The main technical gates are WebKit/DOM measurement fidelity, PNG/clipboard export replacing Chromium CDP screenshots, secure settings/key migration, and native test coverage. Keep this tested Electron version while proving those pieces. [Tauri architecture](https://v2.tauri.app/concept/architecture/).
