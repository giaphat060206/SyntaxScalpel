# SyntaxScalpel — Session Handoff

Paste this whole file into a new session to continue the work.

---

## 1. What this project is

**SyntaxScalpel** — a local-first Tauri desktop app for codebase comprehension. It dissects a local project into
interactive graphs and documentation so a newcomer can understand it fast.

Dual purpose:
- **Folder/project graph** — folder blocks containing file blocks; file→file import edges; no functions shown.
- **Function graph** — one file's functions/classes/methods/variables as a graph; clicking a definition opens a
  highlighted code pane for that section.

Repo folder is `SyntaxScalper` (older name); the product name is **SyntaxScalpel**.

- Working directory: `D:\College\Personal Projects\SyntaxScalper`
- Git: branch **`feature/elk-layout`** (all recent work), base `main` @ `80561fb`. `main` is behind.
- OS: Windows. Shell: **PowerShell 5.1** — never use `&&`; use `;` or `cmd1; if ($?) { cmd2 }`.
- Communication style the user asked for: terse "smart caveman" (drop filler/articles, keep technical accuracy).

## 2. Tech stack

- **Shell/runtime:** Tauri v2 (WebView2), React 18 + TypeScript (strict, `noUnusedLocals`), Vite.
- **Backend:** Rust; `tree-sitter` 0.25, `tree-sitter-python` 0.23, `tree-sitter-typescript` 0.23,
  `tree-sitter-javascript` 0.25; `serde`/`serde_json`.
- **Frontend libs:** `@xyflow/react` (React Flow v12), `react-resizable-panels` v4 (`Group`/`Panel`/`Separator`,
  percentage-string sizes), `react-markdown` + `remark-gfm` + `rehype-highlight`, `highlight.js` (core build with
  languages registered), `elkjs` (layout + orthogonal routing), Tailwind v3.4 + `@tailwindcss/typography`, Vitest.
- **Fonts/theme:** dark surgical theme. Tokens: bg `#1E2329`, panel `#161B20`, accent `#00F0FF`, mint `#3DF0A8`,
  dimmed `#8A93A0`.

## 3. Commands

```powershell
npm run tauri dev                          # run the app (restart after ANY Rust change)
npm test                                   # Vitest (46 tests)
npm run build                              # tsc + vite build
cargo test --manifest-path src-tauri/Cargo.toml   # 78 tests
```

Logos were reverted by the user — **do not re-add the logo or app icons** unless asked.

## 4. Architecture / file map

```
src-tauri/src/
  lib.rs                 Tauri builder + generate_handler! command list
  models.rs              GraphNode/GraphEdge/ParseResult/Position/NodeKind (serde camelCase)
  parser/mod.rs          python, jsts, imports, project
  parser/python.rs       Python extraction (nodes/params/returns/uses/line ranges/edges)
  parser/jsts.rs         JS/TS shared module (all four extensions)
  parser/imports.rs      Import extraction, specifier resolution, tsconfig aliases, ImportAnalysis
  parser/project.rs      project_graph(root, scope): folders, files, edges, entry points, external nodes
  commands/parse.rs      parse_python, parse_js_ts, analyze_imports
  commands/fs_cmds.rs    list_directory, read_markdown, read_file
  commands/layout.rs     load_layout/save_layout (UNUSED by the UI now; kept)

src/
  main.tsx               entry; wraps App in ErrorBoundary; installs a global error overlay
  index.css              Tailwind + React Flow control styling + edge layer z-index
  shared/                types.ts, ipc.ts, extensions.ts, StateViews.tsx, ErrorBoundary.tsx
  features/
    explorer/FileExplorer.tsx     collapsible tree (collapsed by default), folder picker, search box
    graph/
      GraphView.tsx               function graph: React Flow, ELK placement, trace, hover card, menu, search
      CodeNode.tsx                block rendering (function/class/variable/special/project variants)
      flow.ts / trace.ts / layout.ts / colors.ts / GraphSearch.tsx
      elk/                        graph.ts, result.ts, path.ts, layout.ts (worker+fallback), ElkEdge.tsx
    markdown/MarkdownView.tsx
    code/CodeView.tsx, highlight.ts   highlighted section reader with line-number gutter
    project/ProjectGraph.tsx, selection.ts   folder/file graph, collapse, entry chip, card, context menu
    shell/
      App.tsx                     state, panels, breadcrumb, split docs, top bar, welcome gate
      TopBar.tsx                  File menu (Open Folder/File, Recent Folders flyout, Close Folder)
      Welcome.tsx                 start screen when no folder open
      ContentPane.tsx             routes markdown/graph, hosts the code pane overlay
      SearchContext.tsx           graphs publish search items; explorer renders the box
      useFileContent.ts, useImports.ts, useRecents.ts, Breadcrumb.tsx
docs/superpowers/specs/  design specs (incl. 2026-09-29-elk-layout-design.md)
docs/superpowers/plans/  implementation plans (incl. 2026-09-29-elk-layout.md)
```

## 5. Behaviour (current)

### Explorer (left panel)
- "Open Folder" + search box + collapsible tree; **all folders start collapsed**.
- Search (click the box; `Ctrl+F` belongs to the graph's own search) filters the active graph's items:
  **folders/files navigate** (folder → folder graph, file → code graph), **symbols centre** in the code graph.
- Home button (`⌂`) closes the folder and returns to Welcome.

### Top bar / Welcome
- `File` menu: **Open Folder…**, **Open File…** (its directory becomes the project root), **Recent Folders ▸**
  (flyout panel on the right), **Close Folder**.
- Welcome screen when no folder is open: Open Folder/File + recent folders (persisted in `localStorage`,
  normalized so `C:\a\b` and `C:/a/b` dedupe).

### Project graph
- Folder blocks contain their files and subfolders; file→file import edges; docs/config files shown (muted) with
  edges only from real imports; **external nodes** (grey, `ext` badge) for imports resolving outside the scope.
- Entry point detection: `index.html` script → Python `__main__` guard → conventional names (**per folder**, so a
  monorepo marks `backend/server.js` and `frontend/main.jsx`) → each folder's `package.json` → graph roots.
  Multiple entries are supported; the primary sorts first and the **Start** panel is collapsible with one
  bulleted line per entry (paths relative to the current folder).
- Click a folder/file → dims unrelated blocks/lines. Right-click a block → **Open folder/file graph**, Re-align,
  Fit view. Double-click also navigates. Collapse a folder with its chevron.

### Function graph
- Clicking a definition (function/method/class/variable) opens a **code pane beside the graph** with that section
  highlighted (`highlight.js`), line-number gutter, `Wrap` toggle, and a collapse chevron. The graph stays
  mounted (the pane is an overlay), selecting reopens it, `Show code` reopens when collapsed.
- Imports/imported-by blocks and a constants container; hover/click shows an info card; `Hide/Show lines` toggle;
  bottom-right search (Ctrl+F) centres on a match.

### Layout (ELK)
- ELK owns placement **and** edge routing: hierarchical compound containers, `ORTHOGONAL` routing, sections drawn
  by the custom `elk` edge. Runs in a worker (`elkjs` `?url`) with a dynamic `elk.bundled` fallback and a 15s
  timeout; >1500 nodes or any error falls back to the old grid (`reflowLayout`) + smoothstep.
- Container padding top 72px so the container title is not overlapped.
- **No layout persistence**: `.scalpel/metadata.json` is no longer read/written; dragging is temporary and drag
  end re-runs ELK. (The Rust layout commands remain but are unused.)

### Visual rules
- Node z-index: **containers 1**, **leaf blocks 4**; edges 0. So lines always pass *under* blocks.
- Container blocks are **transparent only when they hold an edge endpoint** (folders on the connected chains,
  classes holding connected methods); all other containers and all leaves are opaque and hide lines.
- Palette colour per block (border, name, outgoing edges); edges are arrowed (`smoothstep`, offset), dim to 12%
  when unrelated to the selection (no bolding).

## 6. Key decisions and constraints (respect these)

- **Single-file graphs**; edges are in-file calls/imports only; class ids are never edge targets; no self-edges.
- Node ids: `name`, `ClassName`, `ClassName.method`, `varName.method`.
- In the project graph, node ids are project-relative paths with `/`; the scope root is not rendered as a
  container (it would span the whole canvas). Folder ids are never `""` (React Flow needs non-empty ids).
- Specifiers: relative imports count leading dots (`.` = own dir, `..` = parent, `...` = grandparent); a target
  whose file name already contains a dot prefers **appending** the extension (`ai.easy` → `ai.easy.js`); imports
  outside the scope become external nodes; `tsconfig.json`/`jsconfig.json` `baseUrl`+`paths` aliases resolve.
- Python `decorated_definition` is unwrapped, so `@staticmethod` methods and `@app.route` functions are extracted;
  the reported line range includes the decorators.
- **Rules of Hooks**: every hook must run before any early return (this bug blanked the entire app once).
- React Flow v12 notes: controlled `nodes`/`edges` need `useNodesState`/`useEdgesState`; do not set the `fitView`
  prop when programmatic centring is used (competing animations = "fling"); centre with
  `getInternalNode(id).internals.userNode.measured` + `positionAbsolute` and `setCenter`; a `useMemo` must list
  every value it reads in its deps (`showLines` was missing once), and a stale `selectedId` must be ignored
  (otherwise the whole graph dims).
- Tauri v2 commands: `#[tauri::command(rename_all = "camelCase")]`, args `{ root, relPath, path }`; all commands
  return `Result<T, String>` and never panic; file reads are root-anchored.
- No comments unless requested; commit only files that belong to the change; do not commit without being asked
  (the user says "Commit" explicitly).
- Error handling: `ErrorBoundary` wraps the app/content; a global overlay in `main.tsx` prints uncaught errors.

## 7. Current state (uncommitted + branch)

- Branch `feature/elk-layout` is **not pushed**; `main` is behind (do not lose the branch).
- **Uncommitted working-tree edits** (made by the user, verified to build):
  - `src/features/graph/GraphView.tsx` — removed the temporary `nodes N · edges M · pts S` diagnostic.
  - `src/shared/ipc.ts` — removed the unused `loadLayout` wrapper.
  - `src/shared/types.ts` — removed the unused `LayoutMap` type.
  - Suggested commit: `chore(ui): drop the graph diagnostic and unused layout helpers`.
- Suites green at the time of writing: `npm test` 46/46, `npm run build`, `cargo test` 78/78.

## 8. Known gaps / next steps (candidates, ask the user which to do)

**Immediate**
1. Commit the three uncommitted cleanup edits above.
2. GUI verification pass (`npm run tauri dev`): project graph (folders/files/entries/external nodes), collapse,
   Re-align, folder→file navigation, function graph + code pane (wrap/collapse), search (both boxes), Welcome +
   recents, top bar File menu, editor collapse buttons, lines toggle.

**Feature work the user has asked about but that is not implemented**
3. **Tabs** for open files (multiple files open at once). Not built.
4. **Project-wide search** (symbols/text across the repo, grouped by file). Not built (per-view search exists).
5. **Guided tour**, **notes/bookmarks**, **progress tracking**, **git history insights**, **AI explanations** —
   discussed in a MoSCoW breakdown; AI items need an Ollama/OpenRouter integration (a "Could" in the design spec).
6. **Vite `resolve.alias`** parsing (only tsconfig/jsconfig aliases are supported) and **Python `sys.path`**
   modelling.
7. Persist UI prefs (wrap toggle, pane collapse, theme) — none persisted today.

**Polish / known limitations**
8. Re-align no longer re-fits the viewport; `spreadHandles` and `layout.ts` are partly vestigial.
9. `CodeView` gutter counts logical lines, so wrapped continuations are unnumbered.
10. No component-level tests for the graph integrations; ELK worker/fallback branches are unit-untested.
11. Spec/plan docs predate the post-ELK features (code reader, Welcome, top bar, search, recents, external
    nodes, aliases, per-folder entries) — the design docs should be updated if the user wants them current.
12. `commands/layout.rs` (load_layout/save_layout) and `parse.rs`'s use of `load_layout` are unused by the UI;
    removing them is optional cleanup.
13. The `>1500 nodes` grid fallback and the `Re-align` menu items exist; confirm they behave on a large project.

## 9. How to resume (suggested first moves)

1. `git status` and `git log --oneline -12` on `feature/elk-layout`; read the three diffs in §7.
2. Run `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml` to confirm green.
3. Read `docs/superpowers/specs/2026-09-29-elk-layout-design.md` and
   `docs/superpowers/plans/2026-09-29-elk-layout.md` (the ELK decisions D1–D8).
4. Ask the user what to do next from §8 (or take "commit the cleanup" as the safe first step).
5. Change Rust ⇒ remind the user to restart `npm run tauri dev`.
