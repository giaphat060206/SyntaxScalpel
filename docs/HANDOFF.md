# SyntaxScalpel — Session Handoff

Paste this whole file into a new session to continue the work.

---

## 1. What this project is

**SyntaxScalpel** — a local-first Tauri desktop app for codebase comprehension. It dissects a local project into
interactive graphs and documentation so a newcomer can understand it fast.

Four views, driven by a `Location` (`empty | folder | code | endpoints`):
- **Project graph** — folder blocks containing file blocks; file→file import edges; entry points; external nodes.
- **Function graph** — one file's functions/classes/methods/variables as a graph; clicking a definition opens a
  highlighted code pane for that section.
- **Endpoints view** — HTTP endpoints across the project's API sources, with request/response schemas.
- **Docs** — Markdown rendered alongside the graph.

Repo folder is `SyntaxScalper` (older name); the product name is **SyntaxScalpel** (the GitHub repo is now
`giaphat060206/SyntaxScalpel`).

- Working directory: `D:\College\Personal Projects\SyntaxScalper`
- Git: integration branch **`feature/backend_endpoints_view`**; `main` is far behind (`80561fb`).
- OS: Windows. Shell: **PowerShell 5.1** — never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- Communication style: terse, direct.

## 2. Tech stack

- **Shell/runtime:** Tauri v2 (WebView2), React 18 + TypeScript (strict, `noUnusedLocals`), Vite.
- **Backend:** Rust; `tree-sitter` 0.25 (+ python/typescript/javascript/rust grammars); `serde`/`serde_json`;
  **`serde_norway`** (YAML, for OpenAPI/YAML specs and `@openapi` blocks).
- **Frontend libs:** `@xyflow/react` (React Flow v12), `react-resizable-panels` v4, `react-markdown` +
  `remark-gfm` + `rehype-highlight`, `highlight.js`, `elkjs`, Tailwind v3.4 + `@tailwindcss/typography`, Vitest.
- **Theme tokens:** bg `#1E2329`, panel `#161B20`, accent `#00F0FF`, mint `#3DF0A8`, dimmed `#8A93A0`.

## 3. Commands

```powershell
npm run tauri dev                                  # run the app (restart after ANY Rust change)
npm test                                           # Vitest frontend tests
npm run build                                      # tsc + vite build (strict, noUnusedLocals)
cargo test --manifest-path src-tauri/Cargo.toml    # Rust tests
```

Do not re-add the logo or app icons (reverted by the user).

## 4. Architecture / file map

```
src-tauri/src/
  lib.rs                 Tauri builder + command list
  models.rs              GraphNode/GraphEdge/ParseResult/NodeKind (serde camelCase)
  parser/
    python.rs            Python extraction
    jsts.rs              JS/TS extraction (shared for .js/.jsx/.ts/.tsx)
    rust.rs              Rust extraction (structs/enums/traits/impls/inline mods as containers)
    function_graph.rs    shared Def + edge/uses/returns assembly
    neighborhood.rs      one-hop Cross-file Call Edges, dashed external blocks, the Import Analysis
    imports/             extract.rs (tree-sitter) + resolve.rs (Resolver, AliasMap) + mod.rs re-exports
    project.rs           project_graph(root, scope): folders, files, edges, entry points, external nodes
    api/                 analyze_api extraction: OpenAPI spec adapter, swagger-jsdoc @openapi adapter,
                         Next.js App Router adapter, $ref resolver, source merge
  commands/
    parse.rs             function_graph, parse_python, parse_js_ts, parse_rust, analyze_imports,
                         project_graph, analyze_api
    fs_cmds.rs           list_directory, read_markdown, read_file
src/
  main.tsx               entry; ErrorBoundary + global error overlay
  shared/                types.ts, ipc.ts, extensions.ts, StateViews.tsx, ErrorBoundary.tsx
  features/
    explorer/FileExplorer.tsx     tree, search box, reveal-current-location, folder click semantics
    graph/
      GraphView.tsx               function graph adapter over useGraphCanvas
      CodeNode.tsx                block rendering
      GraphSearch.tsx             in-graph search box (persists query)
      nodes.ts                    pure buildFunctionNodes/decorateFunctionNodes
      canvas/useGraphCanvas.ts    deep module: ELK lifecycle, viewport, menu, styled edges
      elk/                        graph.ts, result.ts, path.ts, layout.ts, ElkEdge.tsx
    project/
      ProjectGraph.tsx            folder graph adapter over useGraphCanvas
      nodes.ts, folderChain.ts, selection.ts
    endpoints/
      EndpointsPane.tsx, EndpointsView.tsx, SchemaTree.tsx
    markdown/MarkdownView.tsx
    code/CodeView.tsx, highlight.ts
    shell/                        App.tsx, TopBar.tsx, ContentPane.tsx, useAsyncLoad.ts, useApiInventory.ts,
                                  useFileContent.ts, useSource.ts, SearchContext.tsx, useRecents.ts,
                                  Breadcrumb.tsx, Welcome.tsx
docs/superpowers/specs/  design specs; docs/superpowers/plans/  implementation plans
docs/adr/                ADR-0001 single-file graphs (superseded by 0006), 0002 no layout persistence,
                         0003 ELK owns layout, 0004 endpoints static extraction, 0005 Rust Function Graph
                         mapping, 0006 Cross-file Call Edges
GLOSSARY.md              domain vocabulary
```

## 5. Behaviour (current)

### Explorer (left panel)
- Collapsible tree; folders start collapsed but ancestors of the current selection auto-expand, and the selected
  row scrolls into view.
- Single-click a **folder** → pans the folder graph to that block (current zoom); double-click a **folder** →
  opens that folder's graph. Single-click a **file** → opens its function graph. Outside a folder graph (or for a
  folder outside the current scope), folder single-click navigates.
- Search box filters the active graph's items; folder/file results navigate, symbol results zoom to the block.
  The query persists after a pick.

### Top bar / Welcome
- `File` menu (Open Folder/File, Recent Folders flyout anchored to its row, Close Folder) and an **API** button
  (visible when a folder is open) that opens the Endpoints view.
- Welcome screen with recents persisted in `localStorage`.

### Project graph
- Folder blocks contain files/subfolders; file→file import edges; entry-point Start panel; external nodes.
- Right-click menu: Re-align, Fit view, Open folder/file graph. Double-click a block navigates.

### Function graph
- Clicking a definition opens a highlighted code pane beside the graph (overlay; the graph stays mounted).
- One dashed **external block** per file a Cross-file Call Edge reaches, holding only the Definitions it reaches;
  clicking one of those reads **that** file's source into the pane. The dashed block itself has no source section.
- Imports/importers blocks (now only what no block could draw) and a constants container; info card; lines toggle;
  in-graph search (Ctrl+F); truncation banner when the neighbourhood cap was hit.
- Search picks zoom to the matched block's bounds and persist. External Definitions are searchable too.

### Endpoints view
- Scans the **Project Root** (whole project, not the current scope) for OpenAPI/Swagger documents, swagger-jsdoc
  `@openapi` comments, and Next.js App Router `route.{ts,js}` handlers.
- Tag-grouped list + detail (parameters, request body, responses, fidelity badge); Open handler jumps to the
  handler's file Function Graph. Multi-source merge prefers higher fidelity; warnings surface parse failures.

### Layout (ELK)
- ELK owns placement and orthogonal routing, in a worker with a fallback; >1500 nodes or any error falls back to
  the grid + smoothstep. No layout persistence; dragging is temporary.

## 6. Key decisions and constraints (respect these)

- **Single-file extraction, one-hop Cross-file Call Edges** (ADR-0006 supersedes ADR-0001's "in-file only"):
  class ids are never edge targets; no self-edges; cross-file resolution never walks transitively.
- Node ids: `name`, `ClassName`, `ClassName.method`, `varName.method`, `modName.item` (item inside an inline Rust
  `mod`), `path::ClassName.method` (a Definition shown from another file). A `parent` must always name a **class**
  node that is top-level in the same payload — the frontend drops a child whose parent it cannot find.
- **Reachability**: a file-level Definition is reached only when its own name was imported; a Method is reached
  when its Container was imported **and** the calling Definition references it. Blocks cap at 12 files / 40
  Definitions and the payload reports `truncated`.
- **Endpoints are extracted statically** from declared contracts only; never run/query the backend (ADR-0004).
- **Rust maps onto the same four kinds** — containers instead of classes, one container level deep (ADR-0005).
- **No layout persistence** (ADR-0002); **ELK owns layout** (ADR-0003).
- **Rules of Hooks**: every hook runs before any early return.
- React Flow v12: controlled nodes/edges; don't pass the `fitView` prop when centring programmatically; canvas
  viewport helpers are `fitView`, `zoomToNode`, `focusNode`, `centerOn`; ignore a `selectedId` not on the canvas.
- Keep the component tree **stable** across UI toggles (the code pane is an overlay).
- No comments unless asked; commit only when asked and only the files that belong to the change.

## 7. Current state

- `main` is at the merge of PR #9 (Rust support) plus one follow-up refactor commit that landed directly on it.
- Cross-file Call Edges live on branch **`feature/cross-file-call-edges`** (off `main`): `parser/neighborhood.rs`,
  the `function_graph` command, the `FunctionGraph` payload, dashed external blocks in the Function Graph, and the
  JS/TS `export` fix the feature depended on.
- The Endpoints spec is GitHub issue **#1**; its tickets **#2–#7** are closed.
- Suites green at the time of writing: `npm test`, `npm run build`, `cargo test`. The dashed blocks are unit-tested
  (including that the outline is dashed) but have **not** been visually reviewed.

## 8. Known gaps / next steps

- `@openapi` handler navigation resolves the controller import file but keeps the route-local handler id; it only
  selects correctly when the controller module names the object as the import alias does.
- Multiple spec files with different API bases use the first declared base.
- The Endpoints view always scans the Project Root, not the current scope.
- No component tests for the graph integrations beyond the canvas/adapters; ELK worker/fallback branches are
  unit-untested.
- Cross-file resolution misses: a specifier resolving to a barrel that only re-exports (that file declares nothing,
  so it stays text); namespace-qualified calls (`import file2` then `file2.func2()`, `import * as f2`), which need
  receiver tracking; and anything beyond one hop.
- `parse_python` / `parse_js_ts` / `parse_rust` / `analyze_imports` are registered but no longer called by the
  frontend. Retiring them needs `parse_file` rerouted first, or `parse_source` becomes a dead-code warning.
- Rust: calls written inside a macro invocation's arguments produce no edge (macro arguments are unexpanded token
  trees), which also hides a Cross-file Call Edge; a type declared inside an inline `mod` has no Container of its
  own — its methods group under the module; nested containers are not modelled beyond one level.
- Languages covered are Python, JS/TS, and Rust; Go, C, C++, Java, and C# are roadmap.
