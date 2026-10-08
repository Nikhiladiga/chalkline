<img src="build/icon.png" alt="Open Eraser application icon" width="80" />

# Open Eraser

Open Eraser is a desktop editor for architecture diagrams. Describe a system, point it at a code folder, or build a diagram yourself using service icons and connectors. Refine the result on the canvas or in its JSON source, then export it for documentation and presentations.

Use your installed **Codex or Claude Code CLI**, a local model through **LM Studio**, or an **OpenAI-compatible API**. Manual diagram editing does not require an AI provider.

The app keeps diagram files on your computer. AI generation sends your prompt and selected diagram or source evidence to the provider you choose. An installed CLI uses its own login and provider; it does not necessarily run the model locally.

The application is named **Open Eraser**. Its source repository is [Nikhiladiga/chalkline](https://github.com/Nikhiladiga/chalkline).

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Choose an AI provider](#choose-an-ai-provider)
- [Generate and update diagrams](#generate-and-update-diagrams)
- [Architecture from a code folder](#architecture-from-a-code-folder)
- [Edit visually or in code](#edit-visually-or-in-code)
- [Save and export](#save-and-export)
- [Privacy and data handling](#privacy-and-data-handling)
- [Development](#development)
- [Desktop builds and distribution](#desktop-builds-and-distribution)
- [Project documentation](#project-documentation)
- [License and credits](#license-and-credits)

## Features

- Generate architecture diagrams from a description, then make further changes with AI.
- Scan a local code folder to map requests, services, database operations, search, indexing and background work.
- Discover supported installed harnesses and choose between Codex and Claude Code, with an executable-path override when needed.
- Search **3,856 icons**, filter by category, and drag service icons directly onto the canvas.
- Create connections by dragging between **eight ports per icon**: four corners and four edge midpoints.
- Move and resize elements, select multiple elements, duplicate or delete them, edit captions, and move elements into or out of groups.
- Switch the left sidebar between the icon palette and a JSON editor with schema-aware completion and validation.
- Arrange diagrams with auto-layout, navigate with pan/zoom and Fit, and switch between light and dark themes.
- Undo and redo diagram changes, recover unsaved work, and save diagrams as editable JSON files.
- Export PNG at 1× or 2×, SVG, HTML and measured JSON, or copy a PNG to the clipboard. PNG export supports a transparent background.

## Getting started

The current version is **0.1.0**. Run it from source while public desktop downloads and Homebrew distribution are being prepared. The macOS build requires **macOS 13 or later**. Windows and Linux packaging targets are configured, but release validation is still pending.

Install **Node.js 22.18 or later** and **pnpm**, then run:

```sh
git clone https://github.com/Nikhiladiga/chalkline.git
cd chalkline
pnpm install
pnpm dev
```

Installation downloads the Electron runtime. The app opens in development mode with hot reload.

For your first diagram:

1. Open **Settings** and configure an AI provider, or switch to **Icons** to draw manually.
2. Open **AI**, select **New**, and choose a description or a code folder as the source.
3. Select a model and generate the diagram.
4. Adjust icons, captions, positions and connections on the canvas.
5. Save the JSON diagram and choose an export format from **Export**.

## Choose an AI provider

| Provider | What you need | Setup in Open Eraser |
| --- | --- | --- |
| Codex CLI | An installed CLI with a working saved login | Choose **Local CLI (existing login)**, select **Codex**, and use the discovered path or enter one. |
| Claude Code CLI | An installed CLI with a working saved login | Choose **Local CLI (existing login)**, select **Claude Code**, and use the discovered path or enter one. |
| LM Studio | A loaded model and a running local API server | Choose **LM Studio** and set the server URL, normally `http://127.0.0.1:1234/v1`. |
| OpenAI / compatible API | A compatible endpoint and its required credentials | Choose the OpenAI provider, set the base URL, and save an API key if required. |

The harness dropdown discovers **Codex and Claude Code**, the currently supported CLI integrations. Installing a different harness does not automatically add an integration.

The AI panel has a model dropdown and **Refresh** button. Codex models are queried from the installed CLI's model catalog; API model lists come from the configured endpoint. Claude Code offers its supported model aliases. You can also enter a model ID in Settings.

CLI generation uses the harness's saved login without an app API key. It runs with filesystem tools, plugins, MCP and project rules disabled. Codex needs a version that supports `--ignore-user-config` and `--ignore-rules`. The app uses the selected model, or the CLI's built-in default; personal Codex model/provider configuration is not applied to generation.

Settings also let you set the model context size and repair-attempt limit. Generated JSON is validated, and the app can ask the model to repair invalid output before applying it. **Stop** cancels generation.

## Generate and update diagrams

For a new diagram, describe the components and how they interact. For example:

> A client calls an Express API. The API stores books in PostgreSQL and searches a Typesense index. A scheduled job synchronizes changed books into Typesense.

Use **Edit** to update the current diagram:

> Add a Redis cache between the API and PostgreSQL. Keep the search flow unchanged.

AI edits preserve existing element positions by default. Enable **Allow AI to move existing elements** when the model should rearrange them. Each accepted AI change is one Undo step. If you edit the canvas while generation is running, the app asks before applying the result over your newer work.

Auto-layout can reorganize the whole diagram. Review generated components and relationships against the system you are documenting; valid JSON does not guarantee that the architecture is correct.

## Architecture from a code folder

1. In **AI diagram**, select **Source → Code folder**.
2. Choose the project or service directory.
3. Review the eligible-file count, excerpt coverage and scan details.
4. Optionally add a focus, such as `Trace search requests and database writes`.
5. Use **New → Generate** for a fresh architecture overview.

The scanner reads source files, manifests, documentation and deployment configuration without executing the project. It keeps line-numbered evidence, includes short files completely when they fit, and prioritizes runtime operations over import headers in longer files.

The default diagram shows what the application does. Route handlers, ORM models and SDK helpers are grouped into their owning service; edges describe requests, reads/writes, search, indexing, sync and messages. Ask explicitly for an import/dependency graph if that is the view you need. Generated diagrams include a compact source note with references and coverage limitations.

After changing the code, **Rescan** refreshes the evidence. **Edit → Apply** scans again and updates the diagram while preserving existing positions by default. Folder selection lasts for the app session, so choose the folder again after reopening the app. There is no background file watcher.

Large repositories are represented by bounded excerpts, not a complete analysis of every execution path. Even when all eligible files were read, some implementation details may be omitted. Choose a narrower service folder or increase the configured context size when coverage is too limited.

See [code-folder generation](docs/code-folder-architecture.md) for exact limits, exclusions and provider data handling.

## Edit visually or in code

Use **Icons** in the left sidebar to search and browse the catalog. Drag an icon onto the canvas, then use **Details** to adjust its caption and properties. Hover over an icon to access its connection ports and drag a connector to another icon. Dragging an element out of a group changes its membership.

Switch to **Code** to edit the same diagram as JSON. The editor offers property, tag, icon and ID suggestions with `Ctrl+Space`. Valid edits update the canvas; invalid drafts remain editable and must be fixed or discarded before saving.

Diagrams use the Eraser Diagrams format. A small example:

```json
{
  "entities": [
    {
      "tag": "Icon",
      "id": "api",
      "x": 80,
      "y": 80,
      "icon": "server",
      "texts": [{ "text": "API" }]
    },
    {
      "tag": "Icon",
      "id": "database",
      "x": 320,
      "y": 80,
      "icon": "postgres",
      "texts": [{ "text": "PostgreSQL" }]
    }
  ],
  "connections": [{ "from": "api", "to": "database", "label": "SQL" }]
}
```

Groups, shapes, textboxes and other supported diagram entities can be generated by AI or edited through the code pane.

| Action | Shortcut / gesture |
| --- | --- |
| New / Open / Save | `⌘/Ctrl+N`, `⌘/Ctrl+O`, `⌘/Ctrl+S` |
| Save As | `⌘/Ctrl+Shift+S` |
| Undo / Redo | `⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z` |
| Duplicate selection | `⌘/Ctrl+D` |
| Delete selection | `Delete` or `Backspace` |
| Move selection | Arrow keys; hold `Shift` for larger steps |
| Pan | `Space` + drag |
| Zoom | `⌘/Ctrl` + scroll |
| Fit diagram | **Fit** or `Shift+1` |
| Edit a caption | Double-click the text |
| Export PNG / SVG | `⌘/Ctrl+E`, `⌘/Ctrl+Shift+E` |

Canvas shortcuts apply when an input or the code editor does not have focus.

## Save and export

**File → Save** writes an editable JSON diagram. Use **File → Open** to reopen it and **Save As** to create another copy. Unsaved changes trigger close confirmation, and crash recovery includes unfinished code drafts.

| Format | Use |
| --- | --- |
| PNG | Documentation, slides and sharing; 1×/2× resolution and optional transparency. |
| SVG | Scalable export for documentation and graphics workflows. |
| HTML | A rendered diagram page to open in a browser. |
| Measured JSON | The diagram with measured layout information. |
| PNG clipboard | Paste an image into another application. |

Saved diagram files contain diagram data. They do not embed API keys, settings, the selected source folder or the full scan context. Model-generated captions and source notes can still contain details derived from your project.

## Privacy and data handling

Manual edits and file saves stay on your computer. Choosing or rescanning a folder does not call an AI provider; **Generate** or **Apply** sends selected evidence through the configured provider. For folder generation, this includes bounded source excerpts and a file inventory. AI edits also send the current diagram.

The scanner respects root and nested `.gitignore` rules. It skips dependency/build/VCS directories, symlinks, binaries, oversized files, environment/credential files and agent instruction files. It redacts common literal secrets before selecting excerpts. Redaction is best effort: review your source before submitting confidential code.

The app stores API keys using Electron's `safeStorage`; the renderer does not receive saved keys. Settings, recovery data and cached icons use the legacy **`diagrammer`** application-data directory.

Icons are loaded from a local cache or a hosted icon source. Uncached icons may require network access and can show placeholders if unavailable. A local AI endpoint plus cached icons can avoid hosted AI and icon requests; using a cloud-backed CLI still sends generation data to its provider.

## Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the desktop app with hot reload. |
| `pnpm build` | Build the main process, preload and renderer into `out/`. |
| `pnpm start` | Run the built app. |
| `pnpm check` | Run TypeScript, Biome and unit tests. |
| `pnpm test` | Run unit tests. |
| `pnpm test:e2e` | Build and run the Playwright Electron suite. |
| `pnpm eval:s3` | Run the S3 diagram evaluation. |

Live harness acceptance tests are opt-in and use the selected CLI's login and quota. See [code-folder generation](docs/code-folder-architecture.md) for the synthetic Codex test and [the import-clutter regression](docs/code-folder-imports-fix.md) for the local Typesense sample test. Running a live test against your own project sends its selected excerpts to the provider.

The app uses Electron, React, TypeScript, Zustand, CodeMirror, ELK and the Eraser Diagrams packages.

```text
src/main/         Native files, settings, icons, harnesses and exports
src/preload/      Typed bridge between the renderer and main process
src/shared/       Shared IPC validation and project types
src/renderer/     Editor UI, diagram engine, AI pipeline and layout
e2e/              Desktop workflow and opt-in harness tests
icons/            Icon names and aliases
build/            Application icon and packaging resources
docs/             Feature guides, release preparation and assessments
```

## Desktop builds and distribution

| Command | Output |
| --- | --- |
| `pnpm dist:mac` | Local macOS DMG/ZIP with ad hoc signing. |
| `pnpm dist:win` | Windows NSIS installer target. |
| `pnpm dist:linux` | Linux AppImage target. |
| `pnpm release:mac` | Signed/notarized macOS release workflow, with release credentials configured. |
| `pnpm brew:prepare` | Prepare a Homebrew cask from a release archive; see the release guide for arguments. |

Artifacts are written to `dist/`. A local ad hoc macOS build is not a notarized public release. Windows, Linux and Intel macOS need platform-specific acceptance before support is advertised. The development `dev`/`start` commands use a POSIX `env` wrapper; Windows development may require a compatible shell or launching electron-vite directly with `ELECTRON_RUN_AS_NODE` unset.

No public binary release or Homebrew install command is available yet. Follow [Homebrew release preparation](docs/homebrew-release.md) for signing, notarization, release archives, checksums and a personal tap.

The current app uses **Electron**. A **Tauri** port is feasible but has not been implemented. The native WebKit probe verified renderer compatibility on this Mac, not all supported platforms. Native backend migration and PNG export still need proof. See the [Tauri assessment](docs/tauri-feasibility.md).

## Project documentation

- [Code-folder architecture generation](docs/code-folder-architecture.md)
- [Runtime evidence and import-clutter fix](docs/code-folder-imports-fix.md)
- [Production readiness review](docs/production-readiness-2026-10-07.md)
- [Homebrew and macOS release preparation](docs/homebrew-release.md)
- [Tauri feasibility](docs/tauri-feasibility.md)
- [Repository setup and native WebKit results](docs/repository-and-tauri-check.md)
- [Product and integration specification](PLAN.md)
- [Design guidance](DESIGN.md)
- [Implementation decisions](DECISIONS.md)

## License and credits

The application does not yet have a project-level distribution license. Public source availability alone does not grant an open-source license.

The rendering engine uses the MIT-licensed **Eraser Diagrams** packages. The [upstream license](third_party/eraser-diagrams/LICENSE) and font notices are included in packaged resources. Service icons and logos remain their respective owners' marks.
