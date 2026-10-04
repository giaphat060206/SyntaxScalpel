# AGENTS.md

Standing instructions for agents working in this repository.

## Project

**SyntaxScalpel** — a local-first Tauri v2 desktop app for codebase comprehension. It parses a local project
into (a) a **folder/project graph** of folder blocks containing file blocks joined by import edges, and (b) a
**function graph** per code file whose definitions can be clicked to read their highlighted source.

Repo folder is `SyntaxScalper` (older name); the product name is **SyntaxScalpel**.

## Environment

- Windows. Shell is **PowerShell 5.1**: never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- Paths may contain spaces — quote them.
- `npm run tauri dev` must be **restarted after any Rust change** (frontend hot-reloads on its own).

## Commands

```powershell
npm run tauri dev                                  # run the app
npm test                                           # Vitest (frontend unit tests)
npm run build                                      # tsc + vite build (must pass: strict, noUnusedLocals)
cargo test --manifest-path src-tauri/Cargo.toml    # Rust tests (must pass)
```

Run `npm test`, `npm run build`, and `cargo test` before claiming work is done.

## Layout

- `src-tauri/src/parser/` — `python.rs`, `jsts.rs` (shared JS/TS), `rust.rs`, `function_graph.rs` (shared
  assembler), `imports/` (extraction + `Resolver`: specifier resolution, tsconfig aliases), `neighborhood.rs`
  (one-hop cross-file Call Edges + the Import Analysis), `project.rs` (folders/files/edges/entry points/external
  nodes), `api/` (API Endpoint extraction: OpenAPI/Swagger documents, swagger-jsdoc `@openapi` comments, Next.js
  App Router route conventions).
- `src-tauri/src/commands/` — `parse.rs` (commands incl. `analyze_api`), `fs_cmds.rs`, `ai.rs` (settings, key,
  `ai_summary`).
- `src-tauri/src/ai/` — `digest.rs` (layered projection of the parse), `cache.rs` (prompt-hash store),
  `prompts.rs` (Task templates + `PROMPT_VERSION`), `providers/` (one OpenAI-compatible client, `Transport` seam),
  `settings.rs` (keyring behind `SecretStore`), `summary.rs` (digest → cache → provider).
- `src/features/` — `explorer/`, `graph/` (incl. `canvas/`, `elk/`), `markdown/`, `code/`, `project/`,
  `endpoints/`, `ai/` (panel, pickers, egress notice), `shell/`.
- `src/shared/` — `types.ts`, `ipc.ts`, `extensions.ts`, `StateViews.tsx`, `ErrorBoundary.tsx`.
- Design docs: `docs/superpowers/specs/`, plans: `docs/superpowers/plans/`, session handoff: `docs/HANDOFF.md`.

## Backend rules

- All IPC payload structs derive `serde::Serialize` with `#[serde(rename_all = "camelCase")]`; commands return
  `Result<T, String>` and never panic.
- Tauri v2 commands use `#[tauri::command(rename_all = "camelCase")]`; the frontend passes `{ root, relPath, path }`.
- File reads are **root-anchored** (`Path::new(root).join(path)`); paths are project-relative with `/`.
- Node ids: `name` (function), `ClassName` (class), `ClassName.method` (method), `varName.method` (JS object
  method), `modName.item` (item inside an inline Rust `mod`), and `path::ClassName.method` for a Definition shown
  from another file. Every `parent` must name a top-level **class** node in the same payload, because the frontend
  attaches children to their parent and drops orphans.
- In-file Call Edges stay in-file only: a class id is never an **in-file** edge target; no self-edges.
- The Function Graph also carries one-hop Cross-file Call Edges: `neighborhood.rs` resolves each Definition's call
  names against the Import Edges `Resolver` already computes, materialises the far side's Definitions in one dashed
  block per file (the block's id is the file path, and it is the only Container for those Definitions), and reports
  what it could not draw as `residualImports` / `residualImportedBy`. A file-level Definition — including a
  **Class**, reached by a constructor call — is reached only when its own name was imported; a Method is reached
  when its Container is imported **and** referenced by the calling Definition; a **Variable** is never a target.
  Cross-file is deliberately asymmetric with in-file: `Thing()` draws an edge across files but never within one,
  because a cross-file construction is a real file dependency. Blocks are capped (12 files, 40 Definitions) and
  `truncated` is surfaced. See ADR-0006.
- A name imported from a file that only re-exports (a Python `__init__.py`, a TS `index.ts`, a Rust `mod.rs`) is
  followed to the file that declares it — up to three hops, with a visited set so a re-export cycle terminates.
  The dashed block is then labelled with the **declaring** file, which can differ from the specifier written and
  from the file `project.rs` draws its Import Edge to (that still resolves the specifier, so the two views can name
  different files for one import line).
- `function_graph` is the one command the UI calls for a file, returning the file's graph, its Import Analysis, and
  the neighbourhood from a single project scan. `parse_python` / `parse_js_ts` / `parse_rust` / `analyze_imports`
  are still registered but no longer called by the frontend; retiring them means rerouting `parse_file` first.
- Python `decorated_definition` must be unwrapped (`@staticmethod`, `@app.route`); line ranges include decorators.
- JS/TS `export_statement` must be unwrapped (`export function`/`const`/`class`); line ranges include `export`.
  `export default <expression>` declares nothing and stays unparsed.
- Rust: `struct`/`enum`/`union`/`trait`, each `impl` target, and each inline `mod` become **class** containers;
  `fn` inside a container is a method (`Type.fn`), otherwise a function; `function_signature_item` (a trait method
  without a body) is a method with no body; `const`/`static` are variables; line ranges include `#[attribute]`
  lines; parameters render **as written** (`&self`, `factor: i32`); returns come from `return` expressions and
  fall back to the block's trailing expression. See ADR-0005.
- Rust imports: `use` trees flatten to one entry per path (`crate::a::{b, c}` → `crate::a::b`, `crate::a::c`);
  `use path::*` yields names `["*"]`; `mod foo;` (no body) yields `self::foo`; inline `mod` declares no import.
  `crate`/`self`/`super` paths, `::` item paths, and `mod.rs` module files resolve without reading `Cargo.toml`.
- Specifier resolution: count leading dots (`.` own dir, `..` parent, `...` grandparent); a target file name
  containing a dot prefers **appending** the extension (`ai.easy` → `ai.easy.js`) then replacing; `tsconfig.json`
  / `jsconfig.json` `baseUrl` + `paths` aliases resolve; imports resolving outside the scope become **external**
  nodes; recognized extensions are
  `py js jsx ts tsx rs md txt json yaml yml toml ini css scss html sql sh`.
- Entry points: folder `index.html` script → Python `__main__` guard → conventional names **per folder**
  (`main.rs`, then `lib.rs`, for Rust) → folder `package.json` (`main`/`module`/`scripts.start`) → graph roots.
- API Endpoints are extracted **statically** from declared contracts only — OpenAPI/Swagger documents (JSON/YAML),
  swagger-jsdoc `@openapi` comment blocks, and Next.js `**/api/**/route.{ts,js}` handlers — never by running or
  querying the backend. YAML is parsed with `serde_norway`. Fidelity is `full` for published contracts and
  `heuristic` for framework conventions. See ADR-0004.
- AI Summaries live in `ai/` and are called **from Rust only**: the Provider Key is read from the OS keyring to
  build an authorization header, and it never crosses the IPC boundary or reaches the Summary Cache.
- A **Digest** is projected from the parse (`ai/digest.rs`) and is never an IPC payload — the graph payloads run
  1.1–3.6× the size of the source they describe, so sending one costs more than pasting the file. Layers are
  budgeted in characters, and a spent budget sets `truncated` rather than dropping content silently.
- Summaries are content-addressed at `<root>/.scalpel/ai/<sha256 of the rendered prompt>`, the one writer under
  `.scalpel/`; ADR-0002 still governs layout. A missing key, a corrupt entry and an unwritable directory each stay
  non-fatal so an answer still arrives.
- `PROMPT_VERSION` in `ai/prompts.rs` is inside the hashed input, so bumping it invalidates cached answers when a
  Task template changes. Which Digest layers a Task pays for is `prompts::default_options`, so the frontend never
  restates them.
- Provider wire formats, Digest layers, cache layout and the deferred local option:
  `docs/adr/0007-ai-summaries-and-caching.md` and
  `docs/superpowers/specs/2026-10-04-ai-integration-design.md`.

## Frontend rules

- React 18 + TypeScript strict (`noUnusedLocals`). No comments unless asked.
- **Rules of Hooks**: every hook runs before any early return — violating this has blanked the whole app.
- React Flow v12 (`@xyflow/react`): `nodes`/`edges` are controlled, so use `useNodesState`/`useEdgesState` and
  wire `onNodesChange`/`onEdgesChange`; do **not** pass the `fitView` prop when centring programmatically
  (competing animations cause a "fling"); centre with `getInternalNode(id).internals.userNode.measured` and
  `positionAbsolute` via `setCenter`; list every value a `useMemo` reads in its deps; ignore a `selectedId` that
  is not on the canvas (otherwise the whole graph dims).
- Keep the component tree **stable** across UI toggles (the code pane is an overlay) so React Flow never remounts
  — remounting rebuilds the graph and re-runs ELK (visible stutter).
- ELK owns placement and edge routing (worker via `elkjs` `?url`, dynamic `elk.bundled` fallback, 15s timeout);
  >1500 nodes or any error falls back to `layout.ts`'s grid + smoothstep. Container padding top is 72px so block
  titles are not overlapped.
- No layout persistence: `.scalpel/metadata.json` is neither read nor written; dragging is temporary and re-runs
  ELK. Do not reintroduce autosave.
- Visual rules: containers z-index `1`, leaf blocks `4`, edges `0` (lines always under blocks); containers are
  transparent **only when they hold an edge endpoint**; palette colour per block; edges arrowed `smoothstep`,
  unrelated edges dim to 12% on selection (no bolding).
- Cross-file blocks: one dashed block per reached file, labelled `external file` with an `ext` badge, carrying
  `crossFile: "file"` on the block and `crossFile: "definition"` on the Definitions inside it. Do not conflate
  this with `ProjectBlock.external`, which is a Project Graph Leaf outside the Scope.
- Container transparency is derived from a node's **`parentId`**, not from splitting its id: an external Method's
  id is `path::Container.method`, whose last-dot prefix is not a node. Keep it that way or lines into a dashed
  block get hidden behind it.
- A Function Graph is loaded with a single `functionGraph(path, root)` call per file — do not add a second import
  scan beside it. Picking a Definition from another file reads **that** file's source into the code pane; the
  dashed block itself has no source section.
- Navigation is a `Location` (`empty | folder | code | endpoints`); the top-bar **API** button opens the Endpoints
  view. Canvas viewport helpers on `useGraphCanvas`: `fitView` (whole graph), `zoomToNode` (fit a block's bounds),
  `focusNode` (pan to a block at the current zoom), `centerOn` (centre at an explicit zoom).
- Adding a language touches four places: `parser/<lang>.rs` with a `Language` variant, `shared/extensions.ts`
  (`FileRoute` + `CODE_ROUTES`), `shared/ipc.ts` + `shell/useFileContent.ts`, and `code/highlight.ts`. The payload
  shapes stay language-agnostic. See ADR-0005.
- The frontend renders whatever the backend sends, but `graph/nodes.ts` attaches a child to its parent only when
  that parent is a top-level node; a language module must never emit a `parent` that has no container node.
- AI lives in `features/ai/`: the top-bar **AI** button opens the panel beside **API**. Task entries carry labels
  only, because the instructions and the Digest layers they pay for live in Rust. Every Task stays disabled with an
  `Add an API key` reason until a key is held, while the key field itself stays reachable. The panel offers what to
  explain as Whole scope, Files or Definitions, and picking an imported Definition sends the id its Cross-file
  Block carries (`path::local`), which resolves to that file and reuses the answer already cached there.
- The first Task run for a project stops at an egress notice naming the Provider and is remembered per project
  root; the result header keeps naming the Provider. Answers render through `MarkdownView` in the side panel.

## Style and workflow

- Communication: terse, direct; no filler. Code, commits, and PR text are written normally.
- Prefer editing existing files; do not add a library without checking it is already a dependency.
- Commit only when the user explicitly asks, and only the files that belong to that change.
- When a change touches Rust, tell the user to restart `npm run tauri dev`.

## Do not

- Do not re-add the logo assets or regenerate `src-tauri/icons` (reverted by the user).
- Do not add code comments unless requested.
- Do not reintroduce layout persistence or the removed `useLayoutAutosave` hook.
- Do not change the `main` branch history; work on a feature branch.

## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `giaphat060206/SyntaxScalper`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
