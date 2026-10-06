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
  `ai_summary`, `ai_cached`).
- `src-tauri/src/ai/` — `digest.rs` (layered projection of the parse, incl. Connection targets), `cache.rs`
  (prompt-hash store, one Markdown document per summary), `prompts.rs` (Task templates + `PROMPT_VERSION`),
  `providers/` (one OpenAI-compatible client, `Transport` seam), `settings.rs` (keyring behind `SecretStore`),
  `summary.rs` (digest → cache → provider).
- `src/features/` — `explorer/`, `graph/` (incl. `canvas/`, `elk/`, `emphasis.tsx`), `markdown/`, `code/`,
  `project/`, `endpoints/`, `ai/` (panel, pickers, relationship rows, egress notice), `shell/`.
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
- A Cross-file Call Edge to a **member** implies its Container, so a caller that both constructs a class and calls
  a method on it keeps only the member edge — one arrow onto the Definition the call actually names, instead of two
  onto the same dashed block. The rule is per caller: another Definition that only constructs the class keeps its
  own edge, and a Container left with no arrows is dropped from the block rather than drawn as an empty box.
  `neighborhood::prune_implied_containers` owns this, and two tests pin both halves of it.
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
- `ai_cached` is the store's only other reader: it answers "is this request already answered?" so the panel can
  show marks it never saved. It resolves requests through the same `summary::resolve` as `summarize`, which is what
  stops a mark and the click it invites from disagreeing, and it needs no Provider Key because nothing leaves the
  machine. A request it cannot resolve is reported as not cached rather than failing the batch — marks are a hint.
- A **Digest** is projected from the parse (`ai/digest.rs`) and is never an IPC payload — the graph payloads run
  1.1–3.6× the size of the source they describe, so sending one costs more than pasting the file. Layers are
  budgeted in characters, and a spent budget sets `truncated` rather than dropping content silently.
- Summaries are content-addressed at `<root>/.scalpel/ai/<sha256 of the rendered prompt>.md`, the one writer under
  `.scalpel/`; ADR-0002 still governs layout. Each entry is Markdown with a YAML front-matter header, so the store
  is readable and hand-editable and `export_summary` writes it through the same renderer. A missing key, a corrupt
  entry and an unwritable directory each stay non-fatal so an answer still arrives.
- `PROMPT_VERSION` in `ai/prompts.rs` is inside the hashed input, so bumping it invalidates cached answers when a
  Task template changes. Which Digest layers a Task pays for is `prompts::default_options`, so the frontend never
  restates them.
- Provider wire formats, Digest layers, cache layout and the deferred local option:
  `docs/adr/0007-ai-summaries-and-caching.md` and
  `docs/superpowers/specs/2026-10-04-ai-integration-design.md`.
- A **Connection** Target is a pair, written caller first with each end qualified by its own file
  (`algorithms/pathfinder.py::dijkstra` → `utils/helpers.py::push`), so both sides of one relationship render an
  identical Digest and share one cache entry. Its evidence is both ends' signatures plus the exact call sites: the
  parser records a line with every call (`CallSite` in `function_graph.rs`), and the three language modules fill it.
  Direction is identity, so mutual recursion is two Connections, each true.

## Frontend rules

- React 19 + TypeScript strict (`noUnusedLocals`). No comments unless asked.
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
- **The user's viewport wins over a late layout, and framing waits for placement.** The layout effect fires on
  `sizeSignature` — measured heights — and a re-measure therefore runs ELK ~160 ms later and bumps `layoutVersion`,
  part of the fit key. A manual pan or zoom must be reported, and React Flow passes a **null event** for its own
  programmatic moves, so both canvases wire `onMoveStart` to `canvas.noteManualMove()` when the event is real. The
  two fit shapes need **different** rules, and each is pinned by a test in `useGraphCanvas.test.tsx` that fails if
  it is removed: a **whole-graph** fit happens once per token and only after `layoutVersion > 0`, because fitting
  the seeded grid frames bounds ELK is about to replace and leaves the graph off to one side; a **targeted** fit
  retries until the target is measurable and is redone after a layout lands, because a framing done before the
  blocks were placed centred where the block used to be.
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
- Markdown renders through `MarkdownView` with `prose prose-invert`, and how it looks is owned by the typography
  theme in `tailwind.config.js` — including that inline code carries **no backticks**, which the plugin draws with
  CSS `content` that no DOM test can see. Change the styling there, not in the component.
- AI lives in `features/ai/`: the top-bar **AI** button opens the panel beside **API**. Task entries carry labels
  only, because the instructions and the Digest layers they pay for live in Rust. Every Task stays disabled with an
  `Add an API key` reason until a key is held, while the key field itself stays reachable. The panel offers what to
  explain as Whole scope, Files or Definitions, and picking an imported Definition sends the id its Cross-file
  Block carries (`path::local`), which resolves to that file and reuses the answer already cached there.
- The first Task run for a project stops at an egress notice naming the Provider and is remembered per project
  root; the result header keeps naming the Provider and carries Regenerate, Export (a save dialog, then
  `exportSummary`) and Dismiss. Answers render through `MarkdownView` in the side panel.
- A finished Task is marked `✓` with `aria-pressed`, and clicking it again re-displays that answer without a
  request at all. Marks are **derived, never saved**: `ai_cached` recomputes the key a click would use and asks the
  store, so a mark survives a restart and cannot go stale — an edit the Task's own Digest layers do not read leaves
  the answer (and the mark) valid, and one that changes them takes the mark away. Because a stored answer is read
  from this machine, asking for one skips the egress notice; only a request that would reach the provider asks.
- An external Definition's id arrives **already qualified** as `path::local` (`neighborhood::external_id`), and the
  Cross-file Call Edges use that same string. The picker must pass it through, not prefix the block's path again:
  a double-qualified id resolves to nothing and the Digest answers `none of the selected definitions were found`.
- Selecting a Definition in the file graph **focuses** the panel's Relationship section on it, so the section shows
  that one Definition's relationships whichever target the Tasks are set to. The selection arrives from
  `ContentPane` → `App` → `AiPanel` as `selectedDefinitionId`; the panel accepts it only once it can check the id
  against the loaded graph, and a dashed file block (a path, not a Definition) is ignored. The focus **sticks**:
  panning the canvas clear does not empty the section.
- The **folder graph reports its selection too** (`ProjectGraph` → `App` → `AiPanel` as `selectedProjectId`), which
  covers a file and a folder alike: a file gets its own `imports` / `imported by`, a folder gets `scopeRows`. Both
  canvases share one focus — whichever reported last wins — so they cannot both claim the section, and a cleared
  selection is not reported, for the same reason as above.
- The panel's **Relationship** section lists what the current target connects to — `calls` / `called by` for
  selected Definitions, `imports` / `imported by` for files. A Scope turns every edge with an end inside it into
  **two** rows, `a` importing `b` and `b` imported by `a`: one row per pair tags every row `imports` and never names
  the file on the receiving end, which is the half a reader asks about. **Inbound rows sit above outbound ones** —
  what reaches this side, then what it reaches — and within a half the rows stay grouped by the file they describe.
  An outside module being imported gets no `imported by` row of its own — that is the importing file's row. The
  listing is bounded by `MAX_SCOPE_ROWS` and **says** how many it left out rather than quietly showing a prefix.
  Both rows of a pair carry the same pair, so they share one probe, one cache key and one mark. Tags are
  colour-coded through `directionKind`: accent for what this side reaches, mint for what reaches it. A listing that
  is empty because nothing is selected says so, rather than reading as "no relationships".
- A relationship label **wraps** (`break-all`) and is never truncated: a path is one unbroken token, so truncating
  it hides the only thing the row is for. `AiPanel.test.tsx` guards the class, because no DOM assertion can see
  layout, and it also asserts a row's text contains no `//` or `/*` — a comment written among JSX children is not a
  comment, it is text, and it renders. `tsc` and the build both accept it.
- Hovering a relationship row, or an imports/imported-by row in either graph's info card, sets the emphasis in
  `features/graph/emphasis.tsx`: the two ends highlight, the edge between them stays bright and the rest dim. It is
  **visual only** — never a Selection, never a code pane, never a request. `App` owns the one piece of state and the
  provider is controlled, so both sources drive it. The residual Imports and Imported-By Blocks do not participate:
  the counterpart they name is the one with no node.

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
