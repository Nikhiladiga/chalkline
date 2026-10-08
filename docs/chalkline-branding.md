# Chalkline naming verification — 8 October 2026

The application and repository now use the same name: **Chalkline**. Package, archive and Homebrew cask names use `chalkline`; the native bundle identifier is `dev.chalkline.app`.

The rename covers the toolbar, window/document titles, native executable, package metadata, Codex client identity, icon drag format, packaging helpers, Homebrew instructions and project documentation. The README screenshot was recaptured from the renamed application. The existing application icon is retained.

Existing data stays in the legacy `diagrammer` directory. Saved diagram formats, settings and CLI authentication locations are unchanged. A dummy credential encrypted by the development app before the rename decrypted successfully after it; no real stored credentials were inspected.

## Verification

| Check | Result |
| --- | --- |
| TypeScript, Biome and unit tests | Passed; 189 tests in 20 files |
| Electron production build | Passed |
| Focused desktop tests | Seven passed: branding, persistence and visual editing |
| Isolated branding regression | Passed again after isolating its temporary data directory; typecheck and test lint also passed |
| macOS ARM64 bundle | Built as `dist/mac-arm64/Chalkline.app` |
| Native packaged launch | Reports `Chalkline` and `dev.chalkline.app`; signature and metadata checks passed |
| Embedded macOS icon | `icon.icns`, 317,226 bytes, correctly referenced by the bundle |
| Packaged drawing and export | Zero render errors; save, PNG and SVG passed |
| Packaged Codex model discovery | Installed CLI models returned successfully |
| Remaining old application branding | No matches in tracked text files |
| README local links | All resolve |

The macOS bundle is a local ad hoc signed test build. Native Windows/Linux branding and installers have not been tested in this rename. Previously installed app copies are not replaced automatically; launch the rebuilt app or restart development to see the new name.

The user approved committing and pushing this rename on 8 October. Project guidance is consolidated in `AGENT.md`; obsolete internal plans/specifications are removed. No binary release is published by this change.
