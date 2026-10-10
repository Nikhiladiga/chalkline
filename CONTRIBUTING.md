# Contributing to Chalkline

## Prerequisites

- Node.js 24 (22.18+ works)
- pnpm 11 (`corepack enable`)
- macOS 13+ for development (`pnpm dev`/`start` use POSIX `env`, which Windows `cmd.exe` lacks). Windows 10+ is supported for running released builds.

## Setup and run

```sh
pnpm install
pnpm dev
```

`pnpm dev` unsets `ELECTRON_RUN_AS_NODE`, which some shells export.

## Checks

- `pnpm check` runs TypeScript, Biome and unit tests. It must pass; CI runs it on every PR.
- `pnpm test:e2e` runs the Playwright Electron suite. Run it on macOS before UI changes.
- Live CLI tests are opt-in and spend your Codex or Claude Code login quota.

## Project layout

See "Repository layout" in [AGENTS.md](AGENTS.md).

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…` or `chore/…`.
2. Commit as `type:summary`. Types used in history: `feat`, `fix`, `docs`, `test`, `build`, `refactor`, `chore`.
3. Open a pull request. CI must be green.
4. The PR is squash-merged or merged into `main`.

## Releases

Releases are manual. Go to Actions → Release → Run workflow on `main`, pick the bump (patch, minor or major) and optionally draft. The workflow builds macOS DMGs (arm64 and x64) and a Windows EXE; only if every build succeeds it commits the new `version` to `package.json` on `main` (`chore:release vX.Y.Z`), tags `vX.Y.Z` and publishes a GitHub Release with notes generated from merged PRs. A failed build leaves no commit, tag or release; if `main` moves during the build the run fails; start a new run (Actions → Release → Run workflow), because GitHub's Re-run reuses the old commit and will fail. For a draft, the tag is created when you publish the draft, but the `package.json` bump is pushed to `main` immediately; an abandoned draft just leaves a gap in version numbers. If `main` gets branch protection or a ruleset, add GitHub Actions to its bypass list, or the release push is rejected after the build. If the `chore:release` commit was pushed but no release was created: `gh run download <run-id> -D dist && gh release create vX.Y.Z dist/*/* --target <chore:release sha> --title "Chalkline vX.Y.Z" --generate-notes`. Do not create tags by hand. Builds are unsigned.

## Signed macOS release

Only needed for a notarized build. Set these in your shell or CI secrets; never commit them.

- `CSC_NAME`: full certificate identity, e.g. `Developer ID Application: Your Name (TEAMID)`
- Notarization: either `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

```sh
pnpm release:mac        # add `x64` for Intel
```

The command refuses missing credentials, signs with hardened runtime, notarizes, and verifies signature, stapling and Gatekeeper. It never publishes. Upload the unchanged signed ZIP and DMG to the GitHub release, then generate the Homebrew cask from that same archive:

```sh
pnpm brew:prepare --repo Nikhiladiga/chalkline --archive dist/chalkline-<version>-arm64.zip
```

This writes `packaging/homebrew/Casks/chalkline.rb`; copy it into your tap's `Casks/` directory and validate with `brew style --cask` and `brew audit --cask --online`.

## Website

```sh
cd site && pnpm install && pnpm dev
```

The site deploys automatically when `site/**` changes on `main`.

## Third-party code

Keep the license and font notices in `third_party/eraser-diagrams` and the pinned `@eraserlabs/*` 0.2.0 packages.

### Patched dependency

`@eraserlabs/render@0.2.0` is patched (`patches/@eraserlabs__render@0.2.0.patch`) so the router's repair search has a time budget instead of running unbounded. To change the patch:

```sh
pnpm patch @eraserlabs/render@0.2.0 --edit-dir "$PWD/node_modules/.render-edit"   # opens a copy with the current patch applied
# edit dist/browser/route.js, index.js and their .d.ts files there
pnpm patch-commit "$PWD/node_modules/.render-edit"
pnpm exec vitest run src/renderer/engine/renderPatch.test.ts
```

Check that the lockfile diff only touches `@eraserlabs/render` before committing. When upgrading `@eraserlabs/render`, re-create the patch for the new version, or drop it if upstream exposes the budget. After any change, delete `node_modules/.vite` so `pnpm dev` re-bundles the package.
