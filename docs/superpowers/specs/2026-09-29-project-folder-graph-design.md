# SyntaxScalpel — Project Folder Graph — Design Spec

Date: 2026-09-29
Status: Approved design, pending implementation plan

## 1. Overview

Today the app shows one file's function/class graph, or a markdown document. This feature adds a **project view**: clicking a folder renders a graph whose blocks are **folders** (containers) and **files** (leaves), with **file→file** edges wherever one file imports another. Functions/methods are hidden at this level; a file's imported symbols appear only when that file block is clicked.

### Goal

Answer "how do these files depend on each other, and what exactly does this file pull from that one?" without the noise of a full function graph.

### Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope of folder graph | The clicked folder's **subtree** (path-filtered) |
| Subfolder representation | **Nested** subfolder blocks |
| Folder blocks | **Collapsible** (toggle on the block) |
| Edge types | **File→file only** (no folder→folder aggregates) |
| Open a folder/file from the graph | **Double-click** a folder block → its folder graph; double-click a file block → its function graph |
| Location navigation | **Breadcrumb bar** with clickable ancestor segments |
| Functions/methods in project view | Not shown; a file's imports appear in the click card |

## 2. Backend

New module `src-tauri/src/parser/project.rs` and command `project_graph(root, scope_rel)` in `commands/parse.rs` (registered in `lib.rs`, camelCase args).

### Payload (serde, camelCase)

```ts
interface ProjectFolder {
  id: string;        // project-relative path; "." when the scope is the project root
  name: string;      // folder name, or the project root's name when id is "."
  parentId?: string; // parent folder id; absent for the scope root
  depth: number;     // 0 for the scope root
}
interface FileImport {
  targetId: string;  // project-relative path of the imported file
  specifier: string; // as written in source
  names: string[];   // imported symbols (may be empty for module imports)
}
interface ProjectFile {
  id: string;        // project-relative path
  name: string;
  folderId: string;  // containing folder id
  imports: FileImport[];
}
interface ProjectGraph {
  root: string;            // the scope root's relative path
  folders: ProjectFolder[];
  files: ProjectFile[];
  edges: { source: string; target: string }[]; // file→file
  truncated: boolean;      // true when the file cap was hit
}
```

### Rules

- Walk the scope subtree with the existing skip list (`.git`, `node_modules`, `target`, `dist`, `.scalpel`, `__pycache__`, `.venv`, `venv`, dot-dirs), depth cap 12, symlinks skipped.
- Extension allow-list: `py, js, jsx, ts, tsx, rs` (files) — the languages the parsers support. Markdown is not part of the project graph.
- `imports` per file: reuse `imports::extract_imports`, then resolve each specifier with `imports::resolve_specifier` against a stem index built from the scope's files.
- Folder ids are project-relative paths; ids must be non-empty (React Flow requires it), so the scope root uses `.` rather than `""`.
- `edges`: one per (source file, resolved target file), deduplicated. Only kept when the resolved target is **inside the scope**. Unresolved/external specifiers stay in the file's `imports` (with `targetId` empty) but produce no edge.
- Cap: at most 2000 files; when exceeded, stop collecting and set `truncated: true` (frontend shows a warning).
- Deterministic ordering: folders and files sorted by id, edges by (source, target).
- Never panics; unreadable files are skipped.

## 3. Frontend

### Location model

The shell tracks one location instead of the current combination of code/doc state:

```ts
type Location =
  | { kind: "folder"; path: string }  // project-relative folder
  | { kind: "code"; path: string }    // project-relative file
  | { kind: "empty" };
```

- Explorer: clicking a **folder** sets `{ kind: "folder", path }`; clicking a **file** sets `{ kind: "code", path }` (function graph) unless it is markdown, which continues to drive the docs pane.
- Graph double-click: folder block → `{ kind: "folder", path }`; file block → `{ kind: "code", path }`.
- Split view and the markdown pane are unchanged; they are driven by the doc selection plus the current location.

### Breadcrumb bar

- Slim bar above the content pane: crumbs are the segments of the current path from the project root.
- Folder crumb → that folder's project graph; root crumb → the root folder graph.
- When a code file is open, the file is the final crumb and folder crumbs above it navigate to their graphs.
- Trailing crumb is non-clickable.

### Project graph view

- New `src/features/project/ProjectGraph.tsx`; `CodeNode` gains a `project` variant so the same block visual (border, palette colour, resize, content sizing) is reused:
  - **Folder block**: container. Header shows the folder name and a collapse toggle; children are its files and subfolders (`parentId` + `extent: "parent"`).
  - **File block**: leaf showing the file name; its own palette colour.
- Collapsing a folder sets `hidden` on its descendants (React Flow `hidden`), and the block shows `▸`.
- Layout reuses the near-square grid reflow: each container grids its children; nested folders are laid out like class containers/methods, recursively.
- Edges are file→file, arrowed, coloured by the source file's palette colour; selecting a file bolds its edges and dims the rest (same behaviour as the function graph).
- Import blocks (`IMPORTS`, `IMPORTED BY`) and the `CONSTANTS` container are **not** shown in project mode.

### Click / double-click behaviour

- Single click a file block → info card listing `specifier`/target file and the imported `names` (e.g. `utils/helpers.py: add, Thing`).
- Single click a folder block → selects it (no card content beyond its name).
- Double click a folder block → drill into that folder's graph; double click a file block → that file's function graph.
- Right-click menu (re-align, fit view) works in project mode too.

## 4. Testing

- `cargo test`: `project_graph` — folder/file tree with nesting, scope filtering (files outside the scope excluded), cross-folder edge creation, unresolved specifier produces no edge but stays in `imports`, deterministic ordering, empty folder.
- `npm test` / `npm run build`: existing frontend tests plus typecheck.

## 5. Out of scope

- Folder→folder aggregate edges.
- Project-wide function/method graph, or showing functions inside the project view.
- Languages beyond the ones with an extraction module (Python, JS/TS, Rust) in the project graph.
- Persisting project-view layout (positions are session-only, like node sizes).
