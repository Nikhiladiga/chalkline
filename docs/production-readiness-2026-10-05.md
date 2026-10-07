# Production readiness review — 5 October 2026

Historical review. The listed persistence/discard and Windows discovery findings were addressed on 7 October; see the [current review and release gates](production-readiness-2026-10-07.md).

The app successfully generated and edited real diagrams with the installed Codex CLI. It is suitable for continued testing, but I would fix the two unsaved-work issues below before a public Homebrew release. This was a macOS review, not a guarantee of model reliability or a Windows acceptance run.

## Findings still open

### P1 — Saving can mark newer, unsaved changes as saved

Locations: `src/renderer/ui/actions.ts:48`, `src/renderer/doc/store.ts:104`, `src/main/files.ts:46`.

`save()` captures a document snapshot before awaiting file IPC. When the save completes, `markSaved()` clears the current document's dirty flag even if it changed meanwhile. The main-process save also clears recovery. Closing then can lose the newer changes without a warning.

Reproduced in an isolated Electron instance by delaying the save response 250 ms and editing during that delay. The visible document contained "Changed while saving", but `dirty` was `false` after save completed. The response delay was simulated; the state transition used the actual renderer save action and store.

Fix: associate completion with the saved document version and file identity; only clear dirty/recovery for that version. Do not let a late save completion attach its path to a different document opened meanwhile.

### P1 — Invalid code edits are not tracked as unsaved work

Location: `src/renderer/ui/CodePane.tsx:62`, particularly the parse-error return and the commit guarded by `v.ok`.

The editor commits only valid JSON diagrams to the document store. Invalid text remains solely in the editor, so the document can still be considered saved. Save writes the previous valid diagram; closing can lose the edited text without a warning or recovery copy.

Reproduced by loading a saved diagram, changing the editor to `{"entities": [`, and waiting for validation. The editor held the new invalid text while `dirty` remained `false`.

Fix: track the raw editor draft separately, include it in unsaved-change handling and recovery, and make Save clearly handle an invalid draft.

### P2 — Explicitly discarded changes remain eligible for recovery

Locations: `src/main/index.ts:49`, `src/renderer/App.tsx:94`, `src/main/files.ts:55`.

Choosing "Discard changes" on close does not clear the recovery file. The next launch can offer to restore changes the user deliberately discarded.

Reproduced with a dirty document and an existing recovery snapshot, selecting the actual close handler's Discard branch. `recovery.json` remained after the application closed. The dialog response was automated in the isolated test instance.

Fix: clear the matching recovery snapshot on an intentional discard, while preserving recovery for unexpected termination.

### P2 — Windows harness discovery needs platform support

Location: `src/main/claudeCli.ts:37`.

Automatic discovery searches bare `codex` and `claude` filenames, Unix installer paths, and a Unix login-shell fallback. It does not resolve Windows `.exe`/`.cmd` installations or handle `.cmd` launchers. This is a code-inspection finding; Windows execution was not tested. Address it before advertising Windows local-CLI support.

## Fixed during this session

- **Dynamic Codex models:** the installed CLI's app-server `model/list` endpoint supplies the catalog, including pagination. The dropdown refreshes after settings changes and through Refresh. Hidden entries are excluded, duplicates removed, and `CLI default` retains the CLI's configured choice. Failures are surfaced in the panel. Tests cover fragmented JSON, notifications, pagination, changing catalogs, errors, and the desktop dropdown.
- **Finder launch environment:** a packaged-app check reproduced `env: node: No such file or directory` with a minimal PATH. Codex model discovery and generation now add the locally discovered Node runtime directory to their launcher environment. Regression tests cover both paths.
- **Dragging outside containers:** the document-origin clamp prevented movement to the left/above diagrams near zero. Dragging now creates room by translating document coordinates and compensating canvas pan. Membership updates during dragging, so an escaping child does not grow its old container. Tests cover leaving/rejoining a VPC, keeping connections, positive schema coordinates, moving descendants, and a single Undo/Redo step.

## Verification

| Check | Result |
| --- | --- |
| TypeScript, Biome, unit suite (`npm run check`) | Passed: 157 tests across 14 files |
| Production renderer/main/preload build (`npm run build`) | Passed |
| Full desktop regression suite (`npx playwright test`) | Passed: 15 tests; 2 opt-in live-provider tests skipped |
| Final renderer checks after guide alignment adjustment | Passed: group drag, dynamic models, and generate/edit/drag/connect/save/reopen/PNG/SVG flow |
| Codex dropdown after launcher environment correction | Passed |
| Rendering corpus | All 24 fixture layouts matched macOS golden boxes within ±2 px |
| Local macOS arm64 bundle (`electron-builder --mac --dir --publish never`) | Built successfully; signing explicitly skipped by configuration |
| Packaged macOS app with Finder-like PATH (`/usr/bin:/bin`) | Launched with `app.isPackaged = true`, listed eight Codex models plus default, and rendered a diagram with no errors |

The full desktop suite covers mocked generation and editing, user edits during generation, inline/inspector editing, completion suggestions, panes, themes, icon selection, file round trips, close handling and exports. Passing that suite does not negate the targeted persistence failures above.

### Real Codex generation

Used the installed CLI's existing login and default model in an isolated user-data directory. The model catalog returned eight model IDs plus the CLI-default option, without a hardcoded catalog in the application.

| Task | Time | Entities / connections | Result |
| --- | --- | --- | --- |
| AWS serverless API with API Gateway, Lambda, DynamoDB, S3 and a VPC | 28.1 s | 6 / 3 | Generated; no validation errors, overlaps or children outside containers |
| Add Redis while preserving existing services and connections | 25.2 s | 7 / 4 | Updated; no original entities dropped or moved; no validation/layout errors |
| Checkout flowchart with payment decision and success/failure branches | 26.2 s | 6 / 5 | Generated; no validation/layout errors |

These three successful runs demonstrate the current Codex generation/edit path, not reliability across every prompt or explicit catalog model. Real Claude, LM Studio and external API generation were not exercised in this review; their opt-in live tests remained skipped.

## Before Homebrew publication

1. Fix the two P1 persistence issues and discard/recovery behavior, with regression checks.
2. Finalize the public application name. Package metadata, bundle identity and UI currently still use Chalkline.
3. Prepare a versioned release artifact, hosted URL/checksum, tap and install instructions. No tap or release was published by this review.
4. Decide the macOS distribution path. `electron-builder.yml:20` explicitly disables signing. A personal tap can distribute an unsigned app, but it does not remove macOS trust prompts; the official Homebrew Cask repository requires Gatekeeper-compatible applications. See [Homebrew's cask requirements](https://docs.brew.sh/Acceptable-Casks) and [Apple's distribution guidance](https://support.apple.com/en-us/102445).
5. Add the project's chosen license and basic usage/support documentation. Third-party license files are packaged, but no root project license or README was present at review time.

Packaged macOS arm64 launch, rendering and model discovery passed. Intel macOS, Windows, installer upgrades, notarization and uninstall behavior remain untested. The review did not publish, sign or notarize the application.
