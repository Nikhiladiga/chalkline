# Homebrew release preparation — 7 October 2026

Use a **personal Homebrew cask tap** first. The app is a GUI binary, so a cask is the appropriate package. A tap is a GitHub repository named `homebrew-TAPNAME` with a `Casks/chalkline.rb` file. The generator now produces that file from a real ZIP, validates its app name/version/icon/CPU architecture, and computes the archive's actual SHA-256. See [Homebrew's Cask Cookbook](https://docs.brew.sh/Cask-Cookbook) and [tap conventions](https://docs.brew.sh/Taps.html).

The public name is **Chalkline**, the cask token is `chalkline`, the bundle ID is `dev.chalkline.app`, and the archive is `chalkline-VERSION-arm64.zip`. The existing `diagrammer` data directory remains in use, so changing the app name does not erase settings or the icon cache. The current release preparation supports one architecture per generated cask; start with Apple Silicon, then add Intel only after testing an Intel build.

## What is already prepared

- Consistent app name, menu/window title, toolbar name, bundle ID and versioned artifact names.
- A 1024 × 1024 application icon configured for macOS, Windows and Linux. The macOS ZIP includes a generated `icon.icns`.
- Local ad hoc macOS builds, plus a separate fail-closed signed/notarized release command. Local ad hoc signing is not Developer ID signing and does not make a downloaded app pass Gatekeeper.
- The signing entitlements, archive/cask generator, README, and regression fixes from the readiness review.

No public release or tap has been created. A GitHub owner/repository, license choice and signing credentials were not supplied. The working folder also has no `.git` repository; create a clean repository for publication and exclude user data, credentials, caches, `node_modules`, `dist`, and backups.

## Release steps

1. Choose the application's license and add the actual license file. Confirm distribution terms for service icons and preserve the packaged rendering-engine/font notices. Select a public repository such as `OWNER/chalkline` and a tap such as `OWNER/homebrew-apps`.
2. For a release that opens normally on another Mac, enroll in the Apple Developer Program, create/import a **Developer ID Application** certificate and its private key into the build machine's keychain, and provision notarization credentials. Set these in your shell or CI secret store; do not commit them. Official `homebrew/cask` requires Gatekeeper-compatible apps; a personal tap is not a way to waive macOS trust checks. [Homebrew's acceptance requirements](https://docs.brew.sh/Acceptable-Casks), [electron-builder signing/notarization configuration](https://www.electron.build/v26/docs/mac/).
3. Set the next version in `package.json`; install with `pnpm install --frozen-lockfile`, then run `pnpm check` and `pnpm test:e2e` on macOS. The current runtime requires macOS 13+. Test a downloaded/quarantined release on a clean Apple Silicon Mac, including saved login/model discovery, folder selection, Generate/Apply, invalid-code recovery, save, exports, close/reopen, upgrade and uninstall.
4. Build the signed release after setting `CSC_NAME` to the complete certificate identity, such as `Developer ID Application: Your Name (TEAMID)`, and either `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. The release command refuses missing credentials, enables hardened runtime, requires signing, notarizes, then verifies signature, stapling and Gatekeeper. It never publishes:

   ```sh
   pnpm release:mac
   ```

   For Intel, `pnpm release:mac x64`; do not declare Intel support before testing it. To produce a **local testing archive only**, use `pnpm dist:mac` or `pnpm exec electron-builder --mac zip --arm64 --publish never` after a renderer build. An ad hoc build still needs macOS's user trust decision when downloaded.

5. Upload the **unchanged signed** ZIP and DMG to GitHub release `v0.1.0` (substitute the current package version). The final cask checksum must come from that same signed archive, not from the local test build. Generate the cask:

   ```sh
   pnpm brew:prepare --repo OWNER/chalkline \
     --archive dist/chalkline-0.1.0-arm64.zip
   ```

   This writes `packaging/homebrew/Casks/chalkline.rb`. It uses the version from `package.json`, declares Apple Silicon and macOS Ventura or later, and verifies package metadata and icon presence. It does **not** certify notarization or publish the artifact; use the signed release command's verification and test the hosted download.

6. Copy the generated `Casks/chalkline.rb` into `OWNER/homebrew-apps/Casks`, commit and push that tap. Validate it against the hosted download using the current Homebrew commands:

   ```sh
   brew tap OWNER/apps
   brew style --cask OWNER/apps/chalkline
   brew audit --cask --online OWNER/apps/chalkline
   brew install --cask OWNER/apps/chalkline
   open -a 'Chalkline'
   ```

   Run these in a test account/machine so the installer does not overwrite the copy you are using. Check `brew uninstall --cask OWNER/apps/chalkline` as well. Uninstall should leave user diagrams and app settings intact; the generated cask intentionally contains no destructive `zap`.
7. Publish the install command `brew install --cask OWNER/apps/chalkline` in the README. For every update, bump the app version, rebuild/sign/notarize, test the downloaded artifact, create a new tagged release, regenerate the SHA and commit the tap update. Users update with `brew update` and `brew upgrade --cask OWNER/apps/chalkline`.

## Optional official Homebrew submission

Start with the personal tap. `homebrew/cask` has additional acceptance requirements, including distribution provenance, declared platform compatibility, Gatekeeper checks and project notability; a valid cask does not guarantee acceptance. Do not add a quarantine/Gatekeeper bypass to an install script. [Current official requirements](https://docs.brew.sh/Acceptable-Casks).
