# Architecture from a code folder

In **AI diagram**, set **Source → Code folder**, then choose your local project. The app scans without changing or executing its files and shows the eligible file count, excerpt coverage, and scan warnings. Selecting or rescanning a folder does not call an AI provider or replace the canvas.

Choose your harness/provider in Settings and your model in the existing dropdown. Optionally describe a focus, such as “trace API requests and database writes.” Choose **New → Generate** for an architecture overview. Once generated, you can edit it using icons, code, or AI as usual. **Edit → Apply** rescans the folder to pick up changed code, then updates the diagram while preserving existing component positions by default. Each result is one Undo step. Existing save/reopen and PNG/SVG exports work normally.

Folder selection lasts for the app session. After reopening a saved diagram in a new session, choose the source folder again before a code-backed update; folder permissions and paths are not embedded in the diagram JSON.

The approach is inspired by [Archify's repository-authoring guidance](https://github.com/tt-a1i/archify/blob/main/archify/references/repository-authoring.md): find runtime entry points, follow imports and I/O, and distinguish observed behavior from assumptions. Output uses this app's Eraser JSON format, service icons, theme, validation/repair and layout; Archify is not installed or run.

## What reaches the provider

Only Generate or Apply sends selected, line-numbered source excerpts and a bounded inventory through your selected provider. The same flow works with Claude Code, Codex, OpenAI and LM Studio. CLI harnesses retain their existing isolated execution paths; this feature does not enable filesystem tools in the selected source folder. Hosted providers can receive code even when access uses a CLI login rather than an API key.

The scanner respects root and nested `.gitignore` rules, including negations. It skips dependency/build/VCS directories, binary and large files, symlinks, environment/credential/key files, and agent instruction files. Ignore rules that cannot be read safely stop the root scan or exclude the affected subtree. Common literal secret assignments, URL credentials and private-key blocks are redacted from included source; this is best-effort detection, so inspect your project's source before submitting confidential code.

Repository text is treated as untrusted evidence. Instructions in comments or READMEs are not harness instructions. Code is never imported, installed or executed. Snapshot evidence describes current working-tree files, rather than a verified committed revision. Generated source notes are model-authored and should be reviewed against the code.

## Scan coverage

Manifests, deployment configuration, READMEs and runtime entry points receive priority. Short files are included completely when they fit their share of the context budget. Longer excerpts prioritize runtime calls, registrations, routes, database operations, indexing and scheduled jobs before import headers, keeping their original line numbers. Context is shared across top-level modules rather than consumed entirely by the first directory. Dependencies alone do not establish a runtime service.

The default output is a runtime architecture overview, not an import graph. Route handlers, ORM models and SDK clients are grouped into their owning service; edges describe requests, reads/writes, search, indexing and sync. In-process scheduled jobs should not be presented as separately deployed workers. Import/dependency relationships are included only when explicitly requested in the focus field. Generating again uses these rules; a previously saved diagram is not silently rewritten.

Limits: 20,000 directory entries, 256 KB per source file, 32 MB total reading, 32 KB per ignore file, and 4,000–120,000 context characters adjusted to the configured model context size. Excerpts can omit relevant implementation details even when every eligible file was read. Incomplete traversal, skipped large/unreadable files, or omitted excerpts produce a partial-coverage notice. Choose a narrower service folder or a larger model context for a large repository. There is no background watcher: Rescan and Generate/Apply read fresh evidence.

Stop cancels an active scan or generation and prevents a late response from being applied. Scan/provider/validation failures leave the last diagram intact. If you edit the canvas while generation runs, the existing concurrent-edit confirmation protects those changes.

Verification commands: `npm run check`, `npm run build`, `npx playwright test`. The optional real-Codex acceptance fixture runs with `DG_CODE_FOLDER_LIVE=1 npx playwright test e2e/code-folder-live.spec.ts`; it uses the installed CLI's login/quota and synthetic API/Postgres/Redis source.
