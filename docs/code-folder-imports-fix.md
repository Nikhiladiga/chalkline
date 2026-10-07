# Code-folder architecture: import clutter fix

The Typesense Sequelize screenshot exposed a real evidence-selection bug. The scanner read all 13 eligible files, but the old per-file excerpts favored import headers and stopped after 22 selected lines or 1,200 characters for ordinary source. The supplied server excerpt ended before database authentication, Typesense initialization and startup sync. CRUD operations and the scheduled incremental-sync call were also omitted. The model had enough evidence to draw imports, but insufficient evidence to trace much of the runtime behavior.

The fix keeps short files complete when they fit, shares the configured context budget across files, and prioritizes runtime calls before imports in longer files. Line numbers, ignore rules, secret redaction, scan limits and isolated harness execution remain in place. The generation prompt now asks for runtime relationships and groups route handlers, models and SDK helpers into their owning service. Import/dependency graphs require an explicit request.

The updated local scan includes all 13 files within the default 20,768-character budget, using 20,394 characters. It includes the project's server startup, Sequelize CRUD calls, Typesense upserts/deletes and bulk indexing, and scheduled incremental sync. This establishes improved source evidence; it does not establish correctness of a model-generated diagram for that project.

Expected architecture for this sample is the client calling the Express application, the application reading/writing PostgreSQL through Sequelize, search requests reaching Typesense, and in-process synchronization indexing database records into Typesense. The cron scheduler runs in the server process; it should not imply a separately deployed worker.

Verification:

- Two new scanner regressions reproduced the omitted-runtime-call failure before the fix and pass afterward.
- TypeScript, lint and all 189 unit tests pass. The initial sandbox run denied the local mock HTTP server; the rerun with localhost access passed.
- Production build passes.
- Offline desktop folder generation/edit/rescan/Undo/save/export/Stop/error preservation test passes.
- Live Codex with synthetic API/PostgreSQL/Redis source passes: 7 entities and 5 runtime connections, save and SVG export verified, source unchanged. Its isolated empty icon cache produces placeholder icons; this test proves the generation flow rather than icon availability.
- The opt-in Typesense sample acceptance test is prepared but has not run. Automatic approval review rejected sending the local project's excerpts to Codex without explicit consent. Approval has been requested; no local project excerpts were sent by this investigation.

To generate again, restart the app from the updated source (`pnpm dev`), select **AI diagram → New → Code folder**, choose the service folder, and Generate. Existing saved diagrams and an already-installed packaged application are not automatically rewritten or rebuilt by these source changes. Use **New** for a fresh overview; **Edit** prioritizes preserving existing manual positions.

For a live check against the actual sample after approving the source transfer, run:

```sh
DG_CODE_FOLDER_SAMPLE=/absolute/path/to/typesense-node-sequelize-full-text-search pnpm exec playwright test e2e/code-folder-live.spec.ts --grep 'local Typesense'
```

This uses the installed Codex login and sends the scanner's redacted excerpts to its provider. It records a screenshot and generated JSON under ignored `test-results/`, exports SVG, and checks that source-file hashes remain unchanged.
