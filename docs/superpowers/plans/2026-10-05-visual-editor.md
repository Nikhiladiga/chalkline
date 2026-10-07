# Visual Icon Editor Implementation Plan

**Goal:** Add a searchable drag/drop icon sidebar and eight persistent connector points per icon.

**Architecture:** Reuse the current catalog, document operations, pointer gestures and Eraser renderer. Extend Relationship port enums and adapt anchored connections through the already installed Eraser corridor router. Keep both sidebar editors mounted.

**Tech stack:** React, Zustand, Electron, existing Eraser 0.2.0 packages, Vitest and Playwright. Add the already installed `@eraserlabs/layout` 0.2.0 as a direct dependency for its public routing API.

**Spec:** `docs/superpowers/specs/2026-10-05-visual-editor-design.md`.

**Global constraints:** Existing dark UI tokens; no new icon provider; positive document coordinates; no app metadata on entities; no unrelated persistence fixes. Workspace has no Git repository, so verify in place without commits or a worktree.

**Review focus:** Invalid code text across tab switches; drops with non-default zoom/pan; groups near the origin; cancelled gestures creating history; exact corners remaining attached after move/resize and in exports.

## Task 1 — Palette and sidebar

- [x] Add catalog tests for aliases (`s3` → `aws-simple-storage-service`), categories and unknown searches; watch them fail.
- [x] Implement shared catalog search, popular icons and categories; reuse search in the modal.
- [x] Add `leftMode` UI state, Icons/Code tabs, preserved mounted editors, and automatic Code mode for AI drafts.
- [x] Add lazy thumbnails, incremental scrolling, drag payload/preview and keyboard insertion.
- [x] Verify palette search/category/tab flows with Playwright, including preserving an invalid raw code draft while switching tabs.

## Task 2 — Drop operations

- [x] Add failing operation/desktop tests for transformed drop position, unique IDs, smallest containing group and one Undo step.
- [x] Implement icon insertion with the existing document ops and origin translation; use current measured container boxes.
- [x] Add canvas drag/drop handlers with copy preview and no commit on cancel or unrelated drag data.
- [x] Verify center insertion, group insertion, outside/near-origin insertion, duplicate names, zoom/pan and Undo/Redo.

## Task 3 — Eight anchored connectors

- [x] Add failing native-router/schema tests for every side/corner, obstacle avoidance and port persistence; extend `connect` tests for exact duplicates/self-links.
- [x] Add eight port definitions and extend only the Relationship schema. Use native relative ports/corridor routing and feed the resulting points to the renderer/export path.
- [x] Add hover/selection ports, target snapping, live preview, Escape/pointercancel handling and a separate resize grip.
- [x] Verify all eight geometry endpoints, movement/resize, cancellation, save/reopen and PNG/SVG export in Playwright.

## Completion

- [x] Review changed code for stale render state, listener cleanup, hidden editor behavior and compatibility.
- [x] Run `npm run check`, `npm run build` and the complete desktop suite; inspect screenshots at normal and minimum supported window sizes.
- [x] Record results and any limitations in `DECISIONS.md` and this plan.

## Results (6 Oct)

- Completed the three implementation tasks; failing catalog, insertion, port/schema, gesture and compatibility regressions were observed before fixes.
- `npm run check`: TypeScript and Biome pass, 167 unit tests across 16 files pass.
- `npm run build`: succeeds. Full desktop suite: 18 passed, 2 opt-in live-AI tests skipped. The final routing compatibility fixes also received focused unit and desktop reruns.
- Inspected palette at the 900×600 minimum window size and connector screenshots. Fixed two-line label clipping with 88px fixed tiles.
- Independent read-only review found tab-key nudging, straight-label displacement and loss of authored straight polylines; all were reproduced and corrected with regression tests.
- See `docs/visual-editor.md` for interaction guidance and the corner-port JSON compatibility boundary. Existing production-readiness persistence issues and installed bundle publication remain outside scope.
