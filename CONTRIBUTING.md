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

Every push to `main` that changes app files (not only `site/`, Markdown or LICENSE) builds and publishes a GitHub Release with the next patch tag (`vX.Y.Z`): macOS DMGs (arm64 and x64), a Windows EXE, and notes generated from merged PRs. To bump the minor or major version, set `version` in `package.json` in your PR. Do not create tags by hand. Builds are unsigned.

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
