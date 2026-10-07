# Architecture from a code folder

Users choose a local code folder in the AI panel, scan it, and generate or update an editable diagram with their selected provider/model. Desktop folder selection replaces a web upload: source stays on disk and only bounded evidence is sent to that provider. The existing theme, JSON format, validation/repair, layout, Undo, and exports remain the diagram path.

Use Archify's repository-authoring principles as inspiration: find manifests and runtime entry points, trace imports and I/O, ground claims in source locations, distinguish dependencies from deployed services, and mark incomplete evidence. Do not install or execute Archify, copy its renderer, or execute project scripts/instructions.

## Scanner

Main-process code accepts only handles issued by the native folder dialog. Recursively inventory eligible source/config/documentation, respecting nested `.gitignore` rules with the standard `ignore` package. Skip dependency/build/VCS directories, credential files, binary data, symlinks, and large files. Source is opened read-only; imports/scripts are never executed. Deterministic ordering and bounded file/read/context limits prevent runaway scanning. Count coverage and expose limits/errors instead of claiming the entire repo was read.

Prioritize manifests, deployment/configuration, READMEs and runtime entry points. Extract line-numbered imports, registrations, routes, network/database/storage operations and service declarations from all readable source files; include bounded connected excerpts for high-value files. Split context fairly across modules instead of spending the whole budget on the first directory. Redact common secret assignments and URL credentials before evidence reaches the renderer/provider. Credentials, local env files and agent instructions are excluded regardless of ignore rules; source contents are data, never harness instructions.

## UI and generation

AI source selector offers Description or Code folder independently of New/Edit. Choose folder scans locally and shows project name, coverage, warnings and a compact file summary. Selecting a folder does not replace the canvas. Generate/Apply rescans first so changes are reflected. Optional prompt focuses the overview. The selected harness gets the bounded evidence through its existing isolated chat path, with no filesystem tools enabled.

Prompt rules ask for runtime components, real boundaries, and observed relationships, preserving existing IDs/positions in Edit while allowing obsolete code components to disappear. Use simple service icons and captions; include a compact source/coverage note with actual evidence paths. Unseen code is an explicit unknown, not a fact. Keep evidence separate from user instructions and omit unrelated few-shot stories from repository requests to reduce hallucinated AWS topology.

Stop cancels scan/generation and prevents later repair/application. Errors keep the canvas intact and show an actionable message. A successful result uses the existing one-step commit and concurrent-edit guard. The provider/model may be Claude Code, Codex, OpenAI or LM Studio; choosing a folder alone sends no content to a provider. The UI explains that Generate sends selected excerpts to the selected provider.

## Acceptance

Scanner fixtures prove nested ignores, binary/secret/symlink exclusion, redaction, import/I/O evidence, deterministic coverage, resource limits and cancellation. Prompt tests prove evidence isolation and update guidance. Desktop fixtures exercise native-folder selection via the existing test-only environment pattern, generation through a fake installed CLI, editing after a rescan, Undo/save/export, provider failures and cancellation. Run required TypeScript/lint/unit/build and desktop checks; review the complete feature.

No folder ZIP import, continuous watcher, native harness filesystem permissions, committed-revision provenance, language-specific AST frameworks or automatic remote repository clone in this iteration. Snapshot evidence describes current working-tree bytes; bounded scans are disclosed.
