# Code folder architecture implementation

Spec: `docs/superpowers/specs/2026-10-06-code-folder-design.md`. Implement inline in this workspace (no Git repository), then perform one independent read-only feature review. User authorized implementation; proceed without another approval gate.

## 1. Read-only scanner and folder IPC

- [x] Write failing `src/main/projectScan.test.ts` fixtures for source evidence, nested ignores, symlinks, credentials/binary exclusion, redaction, bounded coverage and abort.
- [x] Add `src/shared/project.ts` contracts: `CodeProject {id,name}`, `ProjectScan {name,context,filesRead,filesFound,filesIncluded,limited,warnings,paths}`. No source paths accepted from renderer.
- [x] Implement `scanProject(root,{maxChars,signal})` in `src/main/projectScan.ts` with `ignore`, read-only bounded traversal, ranked line evidence and module-fair excerpts. Return counts/limits; reject unsupported or unreadable roots.
- [x] Implement native folder chooser/handle registry in `src/main/projects.ts`; add `project:choose` (undefined), `project:scan` ({projectId,id,maxChars}) shared channel validation and main handlers. Existing `llm:cancel` cancels scan by request ID. Tests use `DG_TEST_PROJECT_DIR` only under `DG_TEST`.
- [x] Prove tests and TypeScript, including IPC payload bounds.

## 2. Evidence-driven generation

- [x] Add failing prompt tests for code evidence, prompt injection treatment, no example topology, and update/delete guidance.
- [x] Add `sourceContext?: string` to `AiRequest`; `buildMessages(...,sourceContext?)` includes source-backed system instructions and a JSON-encoded evidence section distinct from the user request. `iconSubset` sees evidence-derived service names too.
- [x] Preserve generation repair/layout pipeline; ensure Stop guards subsequent chats and applying a result.

## 3. AI-panel folder flow and integration

- [x] Add source dropdown, choose/rescan actions and coverage UI (small focused `CodeFolder.tsx` panel) to existing AI panel. Folder scan does not commit a diagram; optional prompt works. Generate rescans and uses the currently selected provider/model.
- [x] Add test-only folder selection plus fake installed CLI desktop fixture, verify evidence reaches harness, excludes private files and yields valid themed editable JSON. Change source and Apply, Undo, save/export, and stop/error flows.
- [x] Run `npm run check`, `npm run build`, desktop suite; inspect code-folder UI at minimum window size.
- [x] Fresh-context read-only review of the completed feature; reproduce/fix confirmed findings. Document coverage/data handling/provider behavior and results.

Review focus: repository-content instructions reaching harness, secrets/symlink escapes, partial scans presented as complete, cancellation between scan/chat/repair, edited canvas or refreshed folder being overwritten by stale work.

## Verification (6 Oct)

- Scanner/prompt/IPC regressions were observed failing before their implementations. Independent review found unsafe ignore-rule fallback, incomplete traversal coverage and instruction-file inclusion; all were reproduced before correction.
- Final `npm run check`: TypeScript/Biome pass, 176 unit tests across 18 files pass. `npm run build` passes.
- Complete desktop regression suite: 19 passed, 2 existing live-AI checks skipped. Added an opt-in live-Codex test afterward; it is skipped in ordinary runs.
- Final focused acceptance: fake selected-Claude flow and real installed Codex both pass. Real Codex produced 7 entities and 5 relationships for API/Postgres/Redis/worker code, with no invented AWS infrastructure; save/SVG export succeeded and source bytes stayed identical.
- Inspected minimum-size folder UI and real diagram screenshots. Tightened source-note placement after a visual check: wide, short and outside groups.
- Usage/data-handling/coverage/session-selection boundaries documented in `docs/code-folder-architecture.md`. Source output only; no installed-bundle replacement or Homebrew publication.
